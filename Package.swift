// swift-tools-version:6.2
import PackageDescription

let package = Package(
    name: "Nhanh",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Nhanh", targets: ["Nhanh"]),
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
            dependencies: ["NhanhCore"],
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
