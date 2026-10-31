import javax.inject.Inject

// Canonical CARGO_HOME: ~/.cargo/registry is a symlink on the factory (see apps/bun-android/app/build.gradle).
fun canonicalCargoHome(): String {
    System.getenv("CARGO_HOME")?.let { return it }
    val home = java.io.File(System.getProperty("user.home"), ".cargo")
    val registry = home.resolve("registry").toPath()
    return if (java.nio.file.Files.isSymbolicLink(registry)) registry.toRealPath().parent.toString() else home.path
}

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Rust core for Flutter (crates/bunos-flutter-bridge, flutter_rust_bridge) for every Android ABI: cargo-ndk run from
// Gradle, Cargo through the workspace's serialized wrapper. Output is a generated jniLibs directory of each variant.
abstract class CargoNdkTask : DefaultTask() {
    @get:InputDirectory @get:PathSensitive(PathSensitivity.RELATIVE) abstract val crateDir: DirectoryProperty
    @get:Input abstract val abis: ListProperty<String>
    @get:Input abstract val release: Property<Boolean>
    @get:Internal abstract val workspace: DirectoryProperty
    @get:Internal abstract val ndkDir: Property<String>
    @get:OutputDirectory abstract val outputDir: DirectoryProperty
    @get:Inject abstract val execOperations: ExecOperations

    @TaskAction
    fun build() {
        val out = outputDir.get().asFile
        out.deleteRecursively()
        out.mkdirs()
        val root = workspace.get().asFile
        val cmd = mutableListOf("ndk", "--platform", "24", "--output-dir", out.absolutePath)
        abis.get().forEach { cmd += listOf("--target", it) }
        cmd += listOf("build", "--locked", "-p", "bunos-flutter-bridge", "--lib")
        if (release.get()) cmd += "--release"
        execOperations.exec {
            workingDir = root
            executable = System.getenv("CARGO_NDK") ?: (System.getProperty("user.home") + "/.cargo/bin/cargo-ndk")
            args = cmd
            environment("CARGO", root.resolve("scripts/aphrody/build/rust/cargo-serial.sh").absolutePath)
            environment("ANDROID_NDK_HOME", ndkDir.get())
            environment("APHRODY_CARGO_TARGET_DIR", root.resolve("target/flutter-bridge").absolutePath)
            environment("CARGO_BUILD_BUILD_DIR", root.resolve("target/flutter-bridge/build").absolutePath)
            // Factory runtime lane (four jobs, own flock) shared by Android, JVM and Flutter builds.
            environment("CARGO_HOME", canonicalCargoHome())
            environment("APHRODY_BUILD_HOST", "")
            environment("APHRODY_LOCAL_CARGO", "1")
            environment("APHRODY_CARGO_JOBS", "4")
            environment("APHRODY_CARGO_LOCK_DIR", System.getenv("APHRODY_CARGO_LOCK_DIR") ?: System.getProperty("user.home") + "/.cache/aphrody/lanes/runtime")
            environment("APHRODY_CARGO_LOCK_TIMEOUT_SECS", "10800")
        }
    }
}

val workspaceDir = rootProject.layout.projectDirectory.dir("../../..")
val rustAbis = listOf("arm64-v8a", "armeabi-v7a", "x86", "x86_64")
val ndkVersionPin = "30.0.16248370"
val ndkHome = providers.environmentVariable("ANDROID_NDK_HOME")
    .orElse(providers.environmentVariable("ANDROID_HOME").orElse("/opt/android-sdk").map { "$it/ndk/$ndkVersionPin" })

android {
    namespace = "com.aphrody.bunos.bunos_store"
    compileSdk = 37
    ndkVersion = ndkVersionPin

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    defaultConfig {
        applicationId = "com.aphrody.bunos.store"
        minSdk = 24
        targetSdk = 37
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        ndk { abiFilters += rustAbis }
    }

    buildTypes {
        release {
            // The Store signs release APKs with its own key (apps/webos/store/android.ts); local runs use the debug key.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21
    }
}

flutter {
    source = "../.."
}

val cargoNdkDebug = tasks.register<CargoNdkTask>("cargoNdkDebug") {
    crateDir = workspaceDir.dir("crates/bunos-flutter-bridge")
    abis = rustAbis
    release = false
    workspace = workspaceDir
    ndkDir = ndkHome
    outputDir = layout.buildDirectory.dir("rust/jniLibs/debug")
}
val cargoNdkRelease = tasks.register<CargoNdkTask>("cargoNdkRelease") {
    crateDir = workspaceDir.dir("crates/bunos-flutter-bridge")
    abis = rustAbis
    release = true
    workspace = workspaceDir
    ndkDir = ndkHome
    outputDir = layout.buildDirectory.dir("rust/jniLibs/release")
}

androidComponents {
    onVariants { variant ->
        val cargo = if (variant.buildType == "debug") cargoNdkDebug else cargoNdkRelease
        variant.sources.jniLibs?.addGeneratedSourceDirectory(cargo, CargoNdkTask::outputDir)
    }
}
