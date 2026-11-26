plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.interrobang.pray"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.interrobang.pray"
        minSdk = 29
        targetSdk = 35
        // 덮어 설치하려면 올린다 (→ .claude/rules/android.md)
        versionCode = 2
        versionName = "0.1.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.2.0")

    testImplementation("junit:junit:4.13.2")
    // 단위 테스트의 android.jar 는 org.json 이 빈 껍데기라 진짜 구현을 앞에 둔다
    testImplementation("org.json:json:20240303")
}
