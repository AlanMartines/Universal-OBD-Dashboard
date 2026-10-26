package com.universal.obddashboard

import org.json.JSONObject

/** Número finito, ou JSONObject.NULL (NaN/infinito/nulo viram null no JSON da tela). */
internal fun Double?.orNull(): Any = this?.takeIf { it.isFinite() } ?: JSONObject.NULL
