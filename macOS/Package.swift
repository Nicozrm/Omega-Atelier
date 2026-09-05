// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OmegaAtelierApp",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "OmegaAtelierApp",
            targets: ["OmegaAtelierApp"]
        )
    ],
    targets: [
        .executableTarget(
            name: "OmegaAtelierApp",
            path: "Sources/OmegaAtelierApp",
            resources: [
                .copy("Resources/web")
            ]
        )
    ]
)
