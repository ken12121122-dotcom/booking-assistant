plugins {
    id("com.android.application")
}

android {
    namespace = "com.bookingassistant.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.bookingassistant.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 41
        versionName = "0.4.1"
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        getByName("debug") {
            storeFile = file(System.getProperty("user.home") + "/.android/debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.16.0")
}
