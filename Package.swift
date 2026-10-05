// swift-tools-version:6.2
import PackageDescription

let package = Package(
    name: "Nhanh",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Nhanh", targets: ["Nhanh"]),
    ],
    dependencies: [
        // Terminal thật trong cửa sổ repo (giả lập VT100/xterm + PTY) — như terminal tích hợp của GitKraken.
        // Ghim 1.11.x: từ 1.12 SwiftTerm có shader Metal, cần Xcode đầy đủ mới build được (máy chỉ có Command Line Tools thì lỗi).
        .package(url: "https://github.com/migueldeicaza/SwiftTerm.git", exact: "1.11.2"),
    ],
    targets: [
        // Phần lõi: chạy lệnh git, parse output, thuật toán vẽ graph. Không phụ thuộc UI.
        .target(
            name: "NhanhCore",
            path: "Sources/NhanhCore"
        ),
        // App SwiftUI/AppKit. Mặc định mọi thứ chạy trên MainActor.
        .executableTarget(
            name: "Nhanh",
            dependencies: ["NhanhCore", .product(name: "SwiftTerm", package: "SwiftTerm")],
            path: "Sources/Nhanh",
            swiftSettings: [.defaultIsolation(MainActor.self)]
        ),
        .testTarget(
            name: "NhanhCoreTests",
            dependencies: ["NhanhCore"],
            path: "Tests/NhanhCoreTests"
        ),
    ]
)
