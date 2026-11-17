import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// Release signing comes from keystore.properties (git-ignored; see keystore.properties.example).
// Without it, `assembleRelease` signs nothing and Android Studio's "Generate Signed Bundle" asks for the key.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "io.github.tgood91.bushidodapp"
    compileSdk = 36

    defaultConfig {
        // Permanent once published to Google Play. Must match ANDROID_PACKAGE_NAME on the server.
        applicationId = "io.github.tgood91.bushidodapp"
        // 25: static shortcuts (res/xml/shortcuts.xml) need Android 7.1; the TWA needs Chrome 72+ anyway.
        minSdk = 25
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        // The one place the site address is set; the manifest and the Kotlin code read these.
        buildConfigField("String", "SITE_HOST", "\"bushido-dapp.onrender.com\"")
        manifestPlaceholders["siteHost"] = "bushido-dapp.onrender.com"
    }

    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
        // No applicationIdSuffix on debug: the shortcuts and asset links name the package literally.
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// Target Java 17 bytecode with whatever JDK runs Gradle (Android Studio bundles 21), rather than
// demanding a JDK 17 install.
kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.browser.helper) // LauncherActivity and the TWA meta-data conventions
    implementation(libs.androidx.browser)
    implementation(libs.androidx.core)
    testImplementation(libs.junit)
}
