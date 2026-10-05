//! Thaigit's credential helper: when git asks "which account should I sign in to this host with", the app returns the
//! right account's token.
//!
//! Mechanism (like askpass): the app binary itself acts as the helper — `thaigit --credential-helper get|store|erase`.
//! That process reads git's credential protocol on stdin, asks the app over 127.0.0.1 using the PER-COMMAND token, and
//! prints `username=` / `password=` for git. The token never sits in the git process's environment, is never written to
//! the repo config, and never appears in command arguments or the Command log.
//!
//! Only `get` is answered; `store` / `erase` are skipped so a token is not copied to another helper (osxkeychain, GCM…) and
//! a token the user stored themselves is not deleted. A host with no account in the app (or an owner matching no
//! account) makes the helper stay silent — git then falls back to `GIT_ASKPASS` and the in-app dialog as usual.

use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};

use tauri::Manager;

use crate::accounts::Accounts;
use crate::errors::AppError;

/// Helper process flag: `<exe> --credential-helper get`.
pub const HELPER_FLAG: &str = "--credential-helper";
pub const PORT_ENV: &str = "THAIGIT_CRED_PORT";
pub const TOKEN_ENV: &str = "THAIGIT_CRED_TOKEN";

const MAX_LINE_BYTES: usize = 8 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

/// What git sends the helper (`protocol=https\nhost=github.com\npath=owner/repo\n\n`).
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct CredentialQuery {
    pub protocol: String,
    pub host: String,
    /// `path=owner/repo` (git sends it thanks to `credential.<url>.useHttpPath=true`).
    pub path: String,
    pub username: Option<String>,
}

impl CredentialQuery {
    /// First owner in `path` (`owner/repo`, `group/sub/repo`) — used to pick an account.
    pub fn owner(&self) -> Option<&str> {
        self.path.split('/').find(|segment| !segment.is_empty())
    }
}

/// Read the credential protocol from stdin (lines `key=value`, terminated by a blank line / EOF).
pub fn parse_query(text: &str) -> CredentialQuery {
    let mut query = CredentialQuery::default();
    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else { continue };
        match key.trim() {
            "protocol" => query.protocol = value.trim().to_lowercase(),
            "host" => query.host = value.trim().to_lowercase(),
            "path" => query.path = value.trim().trim_start_matches('/').to_string(),
            "username" if !value.trim().is_empty() => query.username = Some(value.trim().to_string()),
            _ => {}
        }
    }
    query
}

#[derive(Deserialize, Serialize)]
struct ClientRequest {
    token: String,
    op: String,
    #[serde(default)]
    protocol: String,
    #[serde(default)]
    host: String,
    #[serde(default)]
    path: String,
    #[serde(default)]
    username: Option<String>,
}

#[derive(Deserialize, Serialize, Default)]
struct ClientResponse {
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
}

/// The credential session of ONE git command: the token expires when the command ends.
///
/// `hosts` are the hosts this command actually touches (read from the repo's `git remote -v`, or the URL the user is
/// cloning) — the helper is only injected for those hosts, so a command that does not touch github.com produces nothing
/// related to github.com.
pub struct CredentialSession {
    server: Arc<CredentialServer>,
    token: String,
    hosts: Vec<String>,
}

impl CredentialSession {
    pub fn env(&self) -> Vec<(String, String)> {
        vec![(PORT_ENV.to_string(), self.server.port.to_string()), (TOKEN_ENV.to_string(), self.token.clone())]
    }

    pub fn program(&self) -> &OsString {
        &self.server.program
    }

    pub fn hosts(&self) -> &[String] {
        &self.hosts
    }
}

impl Drop for CredentialSession {
    fn drop(&mut self) {
        let mut sessions = self.server.sessions.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(index) = sessions.iter().position(|token| *token == self.token) {
            sessions.remove(index);
        }
    }
}

pub struct CredentialServer {
    port: u16,
    program: OsString,
    accounts: Arc<Accounts>,
    sessions: Mutex<Vec<String>>,
}

impl CredentialServer {
    pub fn start(program: OsString, accounts: Arc<Accounts>) -> std::io::Result<Arc<Self>> {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let server = Arc::new(Self { port, program, accounts, sessions: Mutex::default() });
        let weak = Arc::downgrade(&server);
        tauri::async_runtime::spawn(async move {
            let Ok(listener) = tokio::net::TcpListener::from_std(listener) else { return };
            while let Ok((stream, peer)) = listener.accept().await {
                if !peer.ip().is_loopback() {
                    continue;
                }
                let Some(server) = weak.upgrade() else { break };
                tauri::async_runtime::spawn(async move { server.handle(stream).await });
            }
        });
        Ok(server)
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn session(self: &Arc<Self>, hosts: Vec<String>) -> CredentialSession {
        let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
        self.sessions.lock().unwrap_or_else(|p| p.into_inner()).push(token.clone());
        CredentialSession { server: self.clone(), token, hosts }
    }

    /// Does any account of this host already have a token (i.e. must the helper be injected)?
    pub fn host_known(&self, host: &str) -> bool {
        self.accounts.host_has_token(host)
    }

    async fn handle(self: Arc<Self>, stream: tokio::net::TcpStream) {
        let (read, mut write) = stream.into_split();
        let mut reader = tokio::io::BufReader::new(read.take(MAX_LINE_BYTES as u64));
        let mut line = String::new();
        let request = match tokio::time::timeout(CONNECT_TIMEOUT, reader.read_line(&mut line)).await {
            Ok(Ok(n)) if n > 0 => serde_json::from_str::<ClientRequest>(line.trim_end()).ok(),
            _ => None,
        };
        let response = match request {
            // Only `get`; `store` / `erase` are deliberately skipped.
            Some(request) if request.op == "get" => self.resolve(request),
            _ => ClientResponse::default(),
        };
        let mut text = serde_json::to_string(&response).unwrap_or_else(|_| "{}".into());
        text.push('\n');
        let _ = write.write_all(text.as_bytes()).await;
        let _ = write.shutdown().await;
    }

    /// Pick an account for host + owner and return its token. `None` when no account matches the host.
    fn resolve(&self, request: ClientRequest) -> ClientResponse {
        let sessions = self.sessions.lock().unwrap_or_else(|p| p.into_inner());
        let known = sessions.contains(&request.token);
        if !known || request.protocol != "https" || request.host.is_empty() {
            return ClientResponse::default();
        }
        let query = CredentialQuery { protocol: request.protocol, host: request.host, path: request.path, username: request.username };
        let Some(resolved) = self.accounts.resolve(&query.host, query.owner()) else { return ClientResponse::default() };
        // A URL with a username (`https://alice@host/…`) only ever uses that exact account.
        if let Some(username) = &query.username
            && !username.eq_ignore_ascii_case(&resolved.login)
        {
            return ClientResponse::default();
        }
        match resolved.token {
            Some(token) => ClientResponse { username: Some(resolved.login), password: Some(token) },
            None => ClientResponse::default(),
        }
    }
}

/// The git command touches these HTTPS remotes (the repo's `git remote get-url`, already read by Rust) → the hosts needing a helper.
pub fn helper_hosts(urls: &[String], accounts: &Accounts) -> Vec<String> {
    let mut hosts: Vec<String> = Vec::new();
    for url in urls {
        let Some(target) = crate::accounts::parse_remote(url) else { continue };
        if !target.https || !accounts.host_has_token(&target.host) {
            continue;
        }
        if !hosts.iter().any(|host| host.eq_ignore_ascii_case(&target.host)) {
            hosts.push(target.host);
        }
    }
    hosts
}

/// `-c` pairs inserted before the subcommand: drop the user's helper for THAT host only, then point at the app's helper.
pub fn helper_config(host: &str, program: &Path) -> Vec<String> {
    let quoted = format!("!'{}'", program.to_string_lossy().replace('\'', r"'\''"));
    let key = format!("credential.https://{host}/");
    vec![
        "-c".to_string(),
        format!("{key}helper="),
        "-c".to_string(),
        format!("{key}helper={quoted} {HELPER_FLAG}"),
        "-c".to_string(),
        format!("{key}useHttpPath=true"),
    ]
}

/// Set up during `setup` (after `app.manage(core)`): the 127.0.0.1 server, the app's own exe as helper (Unix: a wrapper script).
pub fn init<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> crate::errors::Result<()> {
    let Some(core) = app.try_state::<Arc<crate::core::Core>>() else { return Ok(()) };
    let Some(program) = std::env::current_exe().ok().map(|exe| helper_program(&core.data_dir, &exe)) else { return Ok(()) };
    let server = CredentialServer::start(program, core.accounts.clone()).map_err(|error| AppError::Io(format!("credential: {error}")))?;
    let _ = core.credential.set(server);
    Ok(())
}

/// The program git will run as the helper: on Unix a wrapper script in the data directory (`credential.sh` →
/// `<exe> --credential-helper "$@"`); on Windows the app's own exe (git runs it through Git for Windows' `sh.exe`, so
/// `!'<exe>' --credential-helper` still works).
pub fn helper_program(data_dir: &std::path::Path, exe: &std::path::Path) -> OsString {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let path: std::path::PathBuf = data_dir.join("credential.sh");
        let quoted = format!("'{}'", exe.to_string_lossy().replace('\'', r"'\''"));
        let script = format!("#!/bin/sh\n# Thaigit: trả token của tài khoản cho host đó khi git hỏi credential.\nexec {quoted} {HELPER_FLAG} \"$@\"\n");
        let current = std::fs::read_to_string(&path).ok();
        let executable = std::fs::metadata(&path).is_ok_and(|meta| meta.permissions().mode() & 0o111 != 0);
        if current.as_deref() != Some(script.as_str()) || !executable {
            crate::store::write_atomic(&path, script.as_bytes()).ok();
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
        }
        path.into_os_string()
    }
    #[cfg(not(unix))]
    {
        let _ = data_dir;
        exe.as_os_str().to_os_string()
    }
}

// --- The helper process (called by git) --------------------------------------------------------------------------------

/// Is this process being called by git as a credential helper?
pub fn is_helper_invocation(args: &[OsString]) -> bool {
    args.iter().skip(1).any(|arg| arg == HELPER_FLAG)
}

/// Early entry point of `main()`: `Some(exit code)` when this process is the helper (already answered).
pub fn client_exit_code() -> Option<i32> {
    let args: Vec<OsString> = std::env::args_os().collect();
    if !is_helper_invocation(&args) {
        return None;
    }
    let op = args.last().map(|arg| arg.to_string_lossy().into_owned()).unwrap_or_default();
    let port = std::env::var(PORT_ENV).ok().and_then(|value| value.parse::<u16>().ok());
    let token = std::env::var(TOKEN_ENV).ok();
    let query = read_stdin_query();
    let answer = match (port, token) {
        (Some(port), Some(token)) => ask_server(port, &token, &op, &query),
        _ => None,
    };
    // Still exit 0 with no answer: the helper stays silent so git falls back to the dialog / reports an auth error.
    let printed = match answer {
        Some((username, password)) => {
            let mut stdout = std::io::stdout().lock();
            writeln!(stdout, "username={username}").and_then(|()| writeln!(stdout, "password={password}")).is_ok()
        }
        None => true,
    };
    Some(i32::from(!printed))
}

fn read_stdin_query() -> CredentialQuery {
    let mut text = String::new();
    let stdin = std::io::stdin();
    let mut handle = stdin.lock().take(MAX_LINE_BYTES as u64);

    let _ = handle.read_to_string(&mut text);
    parse_query(&text)
}

/// Ask the app over 127.0.0.1; `None` = no matching account / the app is not running.
pub fn ask_server(port: u16, token: &str, op: &str, query: &CredentialQuery) -> Option<(String, String)> {
    let mut stream = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, port)), CONNECT_TIMEOUT).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok()?;
    let request = serde_json::to_string(&ClientRequest {
        token: token.to_string(),
        op: op.to_string(),
        protocol: query.protocol.clone(),
        host: query.host.clone(),
        path: query.path.clone(),
        username: query.username.clone(),
    })
    .ok()?;
    stream.write_all(format!("{request}\n").as_bytes()).ok()?;
    let mut line = String::new();
    BufReader::new(std::io::Read::take(stream, MAX_LINE_BYTES as u64)).read_line(&mut line).ok()?;
    let response: ClientResponse = serde_json::from_str(line.trim_end()).ok()?;
    match (response.username, response.password) {
        (Some(username), Some(password)) => Some((username, password)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::{MemoryStore, Provider};

    fn accounts_with_two_accounts() -> Arc<Accounts> {
        let dir = tempfile::tempdir().unwrap();
        let accounts = Accounts::load(dir.path(), Arc::new(MemoryStore::default()));
        accounts.upsert("github.com", Provider::Github, "1", "alice", "Alice", "token-alice").unwrap();
        accounts.upsert("github.com", Provider::Github, "2", "bob", "Bob", "token-bob").unwrap();
        accounts.upsert("gitlab.com", Provider::Gitlab, "3", "carol", "Carol", "token-carol").unwrap();
        accounts.set_organizations("github.com", "bob", vec!["acme".into()]).unwrap();
        accounts
    }

    fn start(accounts: Arc<Accounts>) -> (Arc<CredentialServer>, CredentialSession) {
        let server = CredentialServer::start(OsString::from("/x/helper"), accounts).unwrap();
        let session = server.session(vec!["github.com".into()]);
        (server, session)
    }

    fn ask(server: &Arc<CredentialServer>, session: &CredentialSession, op: &str, query: &CredentialQuery) -> Option<(String, String)> {
        let token = session.env().into_iter().find(|(k, _)| k == TOKEN_ENV).unwrap().1;
        ask_server(server.port(), &token, op, query)
    }

    fn query(host: &str, path: &str) -> CredentialQuery {
        CredentialQuery { protocol: "https".into(), host: host.into(), path: path.into(), username: None }
    }

    #[test]
    fn parses_the_git_credential_protocol() {
        let parsed = parse_query("protocol=https\nhost=GitHub.com\npath=acme/app.git\n\n");
        assert_eq!(parsed.host, "github.com");
        assert_eq!(parsed.owner(), Some("acme"));
        assert_eq!(parse_query("protocol=https\nhost=gitlab.com\npath=/group/sub/app\nusername=bob\n").owner(), Some("group"));
        assert_eq!(parse_query("").owner(), None);
    }

    #[test]
    fn answers_get_with_the_account_of_the_owner() {
        let (server, session) = start(accounts_with_two_accounts());
        assert_eq!(ask(&server, &session, "get", &query("github.com", "acme/app.git")), Some(("bob".into(), "token-bob".into())));
        assert_eq!(ask(&server, &session, "get", &query("github.com", "alice/app.git")), Some(("alice".into(), "token-alice".into())));
        assert_eq!(ask(&server, &session, "get", &query("gitlab.com", "acme/app.git")), Some(("carol".into(), "token-carol".into())));
    }

    #[test]
    fn stays_silent_for_store_erase_unknown_hosts_and_foreign_tokens() {
        let (server, session) = start(accounts_with_two_accounts());
        assert_eq!(ask(&server, &session, "store", &query("github.com", "acme/app.git")), None);
        assert_eq!(ask(&server, &session, "erase", &query("github.com", "acme/app.git")), None);
        assert_eq!(ask(&server, &session, "get", &query("bitbucket.org", "acme/app.git")), None);
        assert!(ask(&server, &session, "get", &query("github.com", "acme/app.git")).is_some());
        // The token belongs to no command → do not answer.
        assert_eq!(ask_server(server.port(), "token-gia", "get", &query("github.com", "acme/app.git")), None);
        // No account for that owner: NEVER fall back to a different account.
        let accounts = accounts_with_two_accounts();
        accounts.remove("github.com", "bob").unwrap();
        let (server, session) = start(accounts);
        assert_eq!(ask(&server, &session, "get", &query("github.com", "acme/app.git")), Some(("alice".into(), "token-alice".into())));
    }

    #[test]
    fn url_username_must_match_the_chosen_account() {
        let (server, session) = start(accounts_with_two_accounts());
        let mut with_user = query("github.com", "acme/app.git");
        with_user.username = Some("bob".into());
        assert_eq!(ask(&server, &session, "get", &with_user), Some(("bob".into(), "token-bob".into())));
        with_user.username = Some("someone-else".into());
        assert_eq!(ask(&server, &session, "get", &with_user), None);
    }

    #[test]
    fn a_finished_command_turns_its_token_off() {
        let accounts = accounts_with_two_accounts();
        let server = CredentialServer::start(OsString::from("/x/helper"), accounts).unwrap();
        let token = {
            let session = server.session(vec!["github.com".into()]);
            let token = session.env().into_iter().find(|(k, _)| k == TOKEN_ENV).unwrap().1;
            assert!(ask_server(server.port(), &token, "get", &query("github.com", "alice/app.git")).is_some());
            token
        };
        assert_eq!(ask_server(server.port(), &token, "get", &query("github.com", "alice/app.git")), None);
    }

    #[test]
    fn only_https_remotes_of_known_hosts_get_a_helper() {
        let accounts = accounts_with_two_accounts();
        let urls = vec![
            "https://github.com/acme/app.git".to_string(),
            "https://gitlab.com/acme/app.git".to_string(),
            "git@github.com:acme/app.git".to_string(),
            "https://bitbucket.org/acme/app.git".to_string(),
            "C:\\thu-muc\\local".to_string(),
        ];
        assert_eq!(helper_hosts(&urls, &accounts), vec!["github.com".to_string(), "gitlab.com".to_string()]);
    }

    #[test]
    fn helper_config_clears_only_that_url_and_quotes_the_path() {
        let config = helper_config("github.com", Path::new("/Applications/Thaigit's App.app/Contents/MacOS/thaigit"));
        assert_eq!(
            config,
            vec![
                "-c".to_string(),
                "credential.https://github.com/helper=".to_string(),
                "-c".to_string(),
                r"credential.https://github.com/helper=!'/Applications/Thaigit'\''s App.app/Contents/MacOS/thaigit' --credential-helper"
                    .to_string(),
                "-c".to_string(),
                "credential.https://github.com/useHttpPath=true".to_string(),
            ]
        );
    }

    #[test]
    fn a_session_remembers_which_hosts_it_serves() {
        let (server, session) = start(accounts_with_two_accounts());
        assert_eq!(session.hosts(), ["github.com".to_string()]);
        assert!(server.host_known("github.com"));
        assert!(!server.host_known("bitbucket.org"));
    }

    /// A network command touching a github.com HTTPS remote: argv carries the helper flag (before the subcommand) and the
    /// env carries this command's own token.
    #[tokio::test]
    async fn a_network_command_gets_the_helper_flag_and_its_own_token() {
        use crate::core::SpawnOptions;
        use crate::policy::{EnvMap, EnvProfile};
        let accounts = accounts_with_two_accounts();
        let core = test_core(accounts.clone()).await;
        let server = CredentialServer::start(OsString::from("/x/helper"), accounts).unwrap();
        let session = server.session(vec!["github.com".into()]);
        let git = core.locator.current().unwrap();
        let args = vec!["--all".to_string()];
        let spec = core.build_spec_with(
            &git,
            SpawnOptions {
                cwd: std::path::Path::new("/tmp"),
                sub: "fetch",
                args: &args,
                stdin: None,
                profile: EnvProfile::Interactive,
                caller_env: Default::default(),
                restrictions: None,
            },
            None,
            Some(&session),
        );
        let argv: Vec<String> = spec.args.iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
        let text = argv.join(" ");
        assert!(text.contains("credential.https://github.com/helper=!"), "{text}");
        assert!(text.contains("--credential-helper"), "{text}");
        assert!(text.contains("credential.https://github.com/useHttpPath=true"), "{text}");
        let sub = argv.iter().position(|arg| arg == "fetch").expect("có subcommand");
        let helper = argv.iter().position(|arg| arg.contains("useHttpPath=true")).expect("có cờ helper");
        assert!(helper < sub, "cờ helper phải trước subcommand: {text}");
        let env = EnvMap::from_pairs(spec.env.clone());
        let token = env.get(TOKEN_ENV).expect("có token của lệnh").to_string_lossy().into_owned();
        assert_eq!(token.len(), 64);
        assert!(env.get(PORT_ENV).unwrap().to_string_lossy().parse::<u16>().is_ok());
        // The app's helper asks the app → the right account per owner.
        assert_eq!(
            ask_server(server.port(), &token, "get", &query("github.com", "acme/app.git")),
            Some(("bob".into(), "token-bob".into()))
        );
        // The command ended → the token expires.
        drop(session);
        assert_eq!(ask_server(server.port(), &token, "get", &query("github.com", "acme/app.git")), None);
    }

    /// SSH remote (the user's own SSH keys) and unknown hosts: nothing is injected.
    #[tokio::test]
    async fn no_helper_for_ssh_remotes_or_unknown_hosts() {
        use crate::core::SpawnOptions;
        use crate::policy::EnvProfile;
        let accounts = accounts_with_two_accounts();
        let core = test_core(accounts).await;
        let git = core.locator.current().unwrap();
        for urls in [vec!["git@github.com:acme/app.git".to_string()], vec!["https://bitbucket.org/acme/app.git".to_string()], vec!["/thu-muc/local".to_string()]] {
            assert!(core.credential_session(&urls).is_none(), "{urls:?}");
        }
        let args: Vec<String> = Vec::new();
        let spec = core.build_spec_with(
            &git,
            SpawnOptions {
                cwd: std::path::Path::new("/tmp"),
                sub: "fetch",
                args: &args,
                stdin: None,
                profile: EnvProfile::Interactive,
                caller_env: Default::default(),
                restrictions: None,
            },
            None,
            None,
        );
        let argv: Vec<String> = spec.args.iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert!(!argv.join(" ").contains("credential."), "{argv:?}");
    }

    async fn test_core(accounts: Arc<Accounts>) -> Arc<crate::core::Core> {
        let dir = tempfile::tempdir().unwrap();
        let env = crate::testutil::clean_env(&dir.path().join("home"));
        crate::core::Core::for_tests_with_accounts(dir.path(), env, accounts).await
    }

    #[cfg(unix)]
    #[test]
    fn the_helper_program_is_a_script_that_execs_the_app() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let program = std::path::PathBuf::from(helper_program(dir.path(), std::path::Path::new("/Applications/Thaigit's App.app/Contents/MacOS/thaigit")));
        assert_eq!(program, dir.path().join("credential.sh"));
        assert_eq!(std::fs::metadata(&program).unwrap().permissions().mode() & 0o111, 0o111);
        let script = std::fs::read_to_string(&program).unwrap();
        let expected = r#"'/Applications/Thaigit'\''s App.app/Contents/MacOS/thaigit' --credential-helper "$@""#;
        assert!(script.contains(expected), "{script}");
    }

    #[test]
    fn recognises_the_helper_invocation() {
        let args = |list: &[&str]| list.iter().map(OsString::from).collect::<Vec<_>>();
        assert!(is_helper_invocation(&args(&["thaigit", "--credential-helper", "get"])));
        assert!(!is_helper_invocation(&args(&["thaigit", "--askpass"])));
        assert!(!is_helper_invocation(&args(&["thaigit", "/repo"])));
    }
}