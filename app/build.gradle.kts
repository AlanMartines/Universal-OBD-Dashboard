import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.universal.obddashboard"
    // Compila com o SDK 37 (exigido pelo androidx.core 1.19); o comportamento segue o targetSdk 36
    compileSdk = 37

    defaultConfig {
        applicationId = "com.universal.obddashboard"
        minSdk = 26
        targetSdk = 36
        versionCode = 24
        versionName = "0.9.1"
    }

    signingConfigs {
        // Chave de debug fixa e versionada: APKs do CI e de qualquer máquina atualizam uns aos
        // outros sem desinstalar (o que apagaria viagens e ajustes).
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
        // Chave de release fora do repositório: variáveis de ambiente (CI) ou ~/.gradle/gradle.properties.
        create("release") {
            fun secret(name: String) = System.getenv(name) ?: project.findProperty(name)?.toString()
            secret("RELEASE_STORE_FILE")?.let { path ->
                storeFile = file(path)
                storePassword = secret("RELEASE_STORE_PASSWORD")
                keyAlias = secret("RELEASE_KEY_ALIAS")
                keyPassword = secret("RELEASE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("debug")
        }
        getByName("release") {
            // Sem a chave configurada o Gradle gera app-release-unsigned.apk (não instalável).
            signingConfigs.getByName("release").takeIf { it.storeFile != null }?.let { signingConfig = it }
            // R8 enxuga as bibliotecas; o código do app é mantido inteiro (proguard-rules.pro), então nada
            // muda de comportamento: ponte JavaScript, Room, serialização e Android Auto seguem como no debug.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        // Igual ao release (R8), mas assinado com a chave de debug: o CI instala num emulador e confere
        // que o app otimizado abre sem travar (job "smoke" em .github/workflows/ci.yml).
        create("smoke") {
            initWith(getByName("release"))
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = true
    }
    testOptions {
        // android.util.Log etc. viram no-op nos testes JVM (CommandQueue registra logs)
        unitTests.isReturnDefaultValues = true
        // Robolectric (teste de migração do Room com SQLite de verdade)
        unitTests.isIncludeAndroidResources = true
    }
    sourceSets {
        // Esquemas exportados pelo Room, lidos pelo MigrationTestHelper nos testes (Robolectric usa os
        // assets da variante). Só no debug: o APK de release não leva esses arquivos.
        getByName("debug").assets.directories.add("$projectDir/schemas")
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_17
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.ktx)
    // registerForActivityResult exige Fragment >= 1.3 (o Car App Library traz uma versão antiga)
    implementation(libs.androidx.fragment.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.webkit)

    // Android Auto
    implementation(libs.androidx.car.app)

    // GPS nativo (Fused Location Provider)
    implementation(libs.play.services.location)

    // Caixa preta (Room / SQLite)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.room.testing)
    testImplementation(libs.androidx.test.core.ktx)
    testImplementation(libs.androidx.test.ext.junit.ktx)
    testImplementation(libs.androidx.car.app.testing)
}
