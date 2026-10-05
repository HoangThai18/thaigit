//! Raw frames of `git_exec` (matching `FrameTag` / `encodeExitFrame` in `packages/contracts/src/ipc.ts`).
//!
//! The first byte is the tag: `1` = one stdout chunk (≤ 64 KB), `2` = one stderr line (split on `\r`/`\n`, bytes
//! preserved), `3` = exit = little-endian i32 + 1 `cancelled` byte. Exit is always the last frame.

pub const TAG_STDOUT: u8 = 1;
pub const TAG_STDERR_LINE: u8 = 2;
pub const TAG_EXIT: u8 = 3;
pub const MAX_STDOUT_FRAME: usize = 64 * 1024;
/// An endless stderr line (no `\r`/`\n`) is cut into several frames of this size.
pub const MAX_STDERR_LINE: usize = 64 * 1024;

pub fn exit_frame(code: i32, cancelled: bool) -> Vec<u8> {
    let mut frame = Vec::with_capacity(6);
    frame.push(TAG_EXIT);
    frame.extend_from_slice(&code.to_le_bytes());
    frame.push(u8::from(cancelled));
    frame
}

pub fn decode_exit_frame(frame: &[u8]) -> Option<(i32, bool)> {
    if frame.len() != 6 || frame[0] != TAG_EXIT {
        return None;
    }
    let code = i32::from_le_bytes([frame[1], frame[2], frame[3], frame[4]]);
    Some((code, frame[5] == 1))
}

pub fn stderr_frame(line: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(line.len() + 1);
    frame.push(TAG_STDERR_LINE);
    frame.extend_from_slice(line);
    frame
}

/// Split stderr into lines on `\r` or `\n` (git uses `\r` for the progress line). `\r\n` counts as one separator.
#[derive(Debug, Default)]
pub struct LineSplitter {
    pending: Vec<u8>,
    after_cr: bool,
}

impl LineSplitter {
    pub fn push(&mut self, data: &[u8], emit: &mut impl FnMut(Vec<u8>)) {
        for &byte in data {
            match byte {
                b'\n' => {
                    if self.after_cr {
                        self.after_cr = false;
                    } else {
                        emit(std::mem::take(&mut self.pending));
                    }
                }
                b'\r' => {
                    emit(std::mem::take(&mut self.pending));
                    self.after_cr = true;
                }
                other => {
                    self.after_cr = false;
                    self.pending.push(other);
                    if self.pending.len() >= MAX_STDERR_LINE {
                        emit(std::mem::take(&mut self.pending));
                    }
                }
            }
        }
    }

    /// The last line has no terminator.
    pub fn finish(&mut self, emit: &mut impl FnMut(Vec<u8>)) {
        if !self.pending.is_empty() {
            emit(std::mem::take(&mut self.pending));
        }
        self.after_cr = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn split(chunks: &[&[u8]]) -> Vec<Vec<u8>> {
        let mut splitter = LineSplitter::default();
        let mut lines = Vec::new();
        for chunk in chunks {
            splitter.push(chunk, &mut |line| lines.push(line));
        }
        splitter.finish(&mut |line| lines.push(line));
        lines
    }

    #[test]
    fn exit_frame_layout_matches_the_typescript_contract() {
        assert_eq!(exit_frame(0, false), [3, 0, 0, 0, 0, 0]);
        assert_eq!(exit_frame(1, true), [3, 1, 0, 0, 0, 1]);
        assert_eq!(exit_frame(-1, true), [3, 0xFF, 0xFF, 0xFF, 0xFF, 1]);
        assert_eq!(exit_frame(0x0102_0304, false), [3, 4, 3, 2, 1, 0]);
    }

    #[test]
    fn exit_frame_round_trips() {
        for (code, cancelled) in [(0, false), (128, true), (-15, false), (i32::MAX, true), (i32::MIN, false)] {
            assert_eq!(decode_exit_frame(&exit_frame(code, cancelled)), Some((code, cancelled)));
        }
        assert_eq!(decode_exit_frame(&[3, 0, 0, 0]), None);
        assert_eq!(decode_exit_frame(&[1, 0, 0, 0, 0, 0]), None);
    }

    #[test]
    fn splits_on_cr_and_lf_keeping_bytes() {
        let lines = split(&[b"Receiving objects:  10%\rReceiving objects: 100%, done.\nremote: ok\n"]);
        assert_eq!(
            lines,
            vec![b"Receiving objects:  10%".to_vec(), b"Receiving objects: 100%, done.".to_vec(), b"remote: ok".to_vec()]
        );
    }

    #[test]
    fn crlf_is_one_separator_even_across_chunks() {
        assert_eq!(split(&[b"a\r\nb\r", b"\nc"]), vec![b"a".to_vec(), b"b".to_vec(), b"c".to_vec()]);
    }

    #[test]
    fn keeps_blank_lines_and_non_utf8_bytes() {
        assert_eq!(split(&[b"a\n\nb\n"]), vec![b"a".to_vec(), Vec::new(), b"b".to_vec()]);
        let latin1 = [0x66u8, 0xE9, 0x0A];
        assert_eq!(split(&[&latin1]), vec![vec![0x66, 0xE9]]);
    }

    #[test]
    fn flushes_the_unterminated_tail_and_caps_long_lines() {
        assert_eq!(split(&[b"fatal: no newline"]), vec![b"fatal: no newline".to_vec()]);
        let long = vec![b'x'; MAX_STDERR_LINE * 2 + 5];
        let lines = split(&[&long]);
        assert_eq!(lines.iter().map(Vec::len).collect::<Vec<_>>(), vec![MAX_STDERR_LINE, MAX_STDERR_LINE, 5]);
    }
}
