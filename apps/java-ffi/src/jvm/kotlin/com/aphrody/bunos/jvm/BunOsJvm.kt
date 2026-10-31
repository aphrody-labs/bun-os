package com.aphrody.bunos.jvm

/**
 * Host-JVM entry points Bun calls through the bun:ffi JNI bridge (crates/android-native `invocation`,
 * packages/bun-android/src/jvm.ts). Static methods only: the bridge resolves `static` signatures.
 */
object BunOsJvm {
    /** `(Ljava/lang/String;)Ljava/lang/String;` */
    @JvmStatic
    fun greet(name: String): String =
        "Hello $name from Kotlin ${KotlinVersion.CURRENT} on Java ${System.getProperty("java.version")} (${System.getProperty("java.vm.name")})"

    /** `(II)I`, throws ArithmeticException on overflow (surfaces as a bridge error in Bun). */
    @JvmStatic
    fun add(left: Int, right: Int): Int = Math.addExact(left, right)

    /** `(Ljava/lang/String;)Ljava/lang/String;`: word count and reversed words, computed on the JVM. */
    @JvmStatic
    fun analyze(text: String): String {
        val words = text.split(Regex("\\s+")).filter { it.isNotEmpty() }
        return "${words.size} words: ${words.reversed().joinToString(" ")}"
    }
}
