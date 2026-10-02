import AppKit
import NhanhCore
import SwiftUI

struct SettingsView: View {
    var body: some View {
        TabView {
            GeneralSettings()
                .tabItem { Label("Chung", systemImage: "gearshape") }
            GitSettings()
                .tabItem { Label("Git", systemImage: "arrow.triangle.branch") }
        }
        .frame(width: 560)
        .padding(.vertical, 8)
    }
}

private struct GeneralSettings: View {
    @AppStorage(Prefs.commitLimit) private var commitLimit = 2000
    @AppStorage(Prefs.logOrder) private var logOrder = LogOrder.date.rawValue
    @AppStorage(Prefs.showRemoteBranches) private var showRemoteBranches = true
    @AppStorage(Prefs.showTags) private var showTags = true
    @AppStorage(Prefs.relativeDates) private var relativeDates = true
    @AppStorage(Prefs.diffContext) private var diffContext = 3
    @AppStorage(Prefs.diffSplit) private var diffSplit = false

    var body: some View {
        Form {
            Section("Graph") {
                Picker("Số commit tải lên graph", selection: $commitLimit) {
                    ForEach([500, 1000, 2000, 5000, 10000, 20000], id: \.self) { value in
                        Text(value.formatted()).tag(value)
                    }
                }
                Picker("Thứ tự commit", selection: $logOrder) {
                    Text("Theo thời gian").tag(LogOrder.date.rawValue)
                    Text("Theo nhánh (topo)").tag(LogOrder.topo.rawValue)
                }
                Toggle("Hiện nhánh remote trên graph", isOn: $showRemoteBranches)
                Toggle("Hiện tag trên graph", isOn: $showTags)
                Toggle("Hiện thời gian tương đối (“3 giờ trước”)", isOn: $relativeDates)
            }
            Section("Diff") {
                Stepper("Số dòng ngữ cảnh quanh thay đổi: \(diffContext)", value: $diffContext, in: 0...20)
                Toggle("Mặc định hiển thị tách đôi (trước | sau)", isOn: $diffSplit)
            }
            UpdateSettingsSection()
        }
        .formStyle(.grouped)
        .onChange(of: commitLimit) { notifyChange() }
        .onChange(of: logOrder) { notifyChange() }
        .onChange(of: showRemoteBranches) { notifyChange() }
        .onChange(of: showTags) { notifyChange() }
        .onChange(of: relativeDates) { notifyChange() }
        .onChange(of: diffContext) { notifyChange() }
    }

    private func notifyChange() {
        NotificationCenter.default.post(name: .nhanhSettingsChanged, object: nil)
    }
}

private struct GitSettings: View {
    @Environment(AppState.self) private var appState
    @AppStorage(Prefs.gitPath) private var gitPath = ""
    @AppStorage(Prefs.pullMode) private var pullMode = PullMode.merge.rawValue
    @AppStorage(Prefs.fetchPrune) private var fetchPrune = true
    @AppStorage(Prefs.autoFetchMinutes) private var autoFetchMinutes = 5

    var body: some View {
        Form {
            Section("Chương trình git") {
                HStack {
                    TextField("Đường dẫn git", text: $gitPath, prompt: Text("Tự động"))
                    Button("Chọn…") {
                        let panel = NSOpenPanel()
                        panel.canChooseFiles = true
                        panel.canChooseDirectories = false
                        panel.directoryURL = URL(fileURLWithPath: "/usr/local/bin")
                        if panel.runModal() == .OK, let url = panel.url { gitPath = url.path }
                    }
                    if !gitPath.isEmpty {
                        Button("Tự động") { gitPath = "" }
                    }
                }
                LabeledContent("Đang dùng") {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(appState.gitExecutablePath).font(.callout.monospaced())
                        Text(appState.gitVersion ?? "—").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Section("Đồng bộ") {
                Picker("Khi bấm Pull", selection: $pullMode) {
                    Text("Merge nếu cần (mặc định)").tag(PullMode.merge.rawValue)
                    Text("Rebase").tag(PullMode.rebase.rawValue)
                    Text("Chỉ fast-forward").tag(PullMode.fastForwardOnly.rawValue)
                }
                Toggle("Xoá nhánh remote đã bị xoá khi fetch (prune)", isOn: $fetchPrune)
                Picker("Tự động fetch", selection: $autoFetchMinutes) {
                    Text("Tắt").tag(0)
                    Text("Mỗi 1 phút").tag(1)
                    Text("Mỗi 5 phút").tag(5)
                    Text("Mỗi 15 phút").tag(15)
                    Text("Mỗi 30 phút").tag(30)
                }
            }
            Section {
                Text("Xác thực: Thaigit dùng SSH key, ssh-agent và Keychain sẵn có trên máy (giống terminal). Nếu cần mật khẩu, token hoặc passphrase, một hộp thoại sẽ hiện ra.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .onChange(of: gitPath) { appState.rebuildEnvironment() }
    }
}
