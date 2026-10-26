# O app inteiro é mantido (sem renomear nem remover): o R8 só enxuga as bibliotecas.
# Ponte JavaScript, entidades do Room, perfis serializáveis e a tela do Android Auto
# dependem de nomes e reflexão; mantendo o pacote todo o release se comporta como o debug.
-keep class com.universal.obddashboard.** { *; }

# kotlinx.serialization: mantém os serializers gerados dos perfis JSON
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class com.universal.obddashboard.obd.** {
    *** Companion;
}
-keepclasseswithmembers class com.universal.obddashboard.obd.** {
    kotlinx.serialization.KSerializer serializer(...);
}
# Ponte JavaScript da WebView
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
