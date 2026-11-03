package com.universal.obddashboard

import android.content.Context
import androidx.core.content.edit
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.universal.obddashboard.obd.DashboardOverride
import com.universal.obddashboard.remote.RemoteSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class VehiclesTest {
    private val c: Context = ApplicationProvider.getApplicationContext()
    private val prefs get() = c.getSharedPreferences("obd_dashboard_settings", Context.MODE_PRIVATE)
    private val remote get() = c.getSharedPreferences("remote_telemetry", Context.MODE_PRIVATE)
    private val uno = "fiat_uno_vivace_7gf"

    @Before fun legacySettings() {
        prefs.edit(commit = true) {
            clear()
            putString("selected_profile", uno)
            putFloat("ethanol_pct", 27f)
            putFloat("fuel_level_l", 20f)
            putString("adapter_device_names", "OBDII")
            putFloat("fuel_correction_$uno", 0.98f)
            putString("dashboard_$uno", DashboardOverride(8000.0, 6500.0, 180.0, 3.0).encode())
        }
        remote.edit(commit = true) { clear(); putString("base_url", "https://painel.exemplo.test"); putBoolean("enabled", true); putString("installation_id", "abc") }
        Vehicles.ensure(c, force = true)
    }

    @Test fun oldSettingsBecomeTheFirstVehicle() {
        val v = Vehicles.selected(c)
        assertEquals(Vehicles.FIRST_ID, v.id)
        assertEquals(uno, v.profileId)
        assertEquals(27.0, AppSettings.ethanolPercent(c, 0.0), 1e-6)
        assertEquals(20.0, AppSettings.fuelLevel(c)!!, 1e-6)
        assertEquals(0.98, AppSettings.fuelCorrection(c).factor, 1e-6)
        assertTrue(AppSettings.hasDashboardOverride(c))
        assertEquals(listOf("OBDII"), AppSettings.adapterNames(c, emptyList()))
        assertEquals("https://painel.exemplo.test", RemoteSettings.baseUrl(c))
        assertTrue(RemoteSettings.enabled(c))
        assertEquals("a identificação da instalação é do celular", "abc", RemoteSettings.installationId(c))
        assertFalse("chave antiga some", prefs.contains("ethanol_pct"))
    }

    @Test fun eachVehicleKeepsItsOwnSettings() {
        val second = Vehicles.add(c, "Segundo <carro>", "generic_obd2", "ABC1D23")
        assertEquals("Segundo carro", second.name)
        Vehicles.select(c, second.id)
        assertEquals("perfil acompanha o veículo", "generic_obd2", prefs.getString("selected_profile", null))
        assertNull(AppSettings.fuelLevel(c))
        assertFalse(AppSettings.hasDashboardOverride(c))
        assertFalse(RemoteSettings.enabled(c))
        AppSettings.setFuelLevel(c, 35.0)
        AppSettings.setAdapterNames(c, "AA:BB:CC:DD:EE:FF")

        Vehicles.select(c, Vehicles.FIRST_ID)
        assertEquals(20.0, AppSettings.fuelLevel(c)!!, 1e-6)
        assertEquals(uno, prefs.getString("selected_profile", null))
        assertEquals(second.id, Vehicles.byAdapter(c, null, "aa:bb:cc:dd:ee:ff")!!.id)
        assertEquals(Vehicles.FIRST_ID, Vehicles.byAdapter(c, "OBDII", "00:00:00:00:00:00")!!.id)
    }

    @Test fun removingAVehicleClearsItsSettingsButNeverTheSelectedOne() {
        val second = Vehicles.add(c, "Segundo", "generic_obd2", null)
        Vehicles.select(c, second.id)
        AppSettings.setFuelLevel(c, 35.0)
        Vehicles.remove(c, second.id)
        assertEquals("o selecionado não é excluído", 2, Vehicles.all(c).size)
        Vehicles.select(c, Vehicles.FIRST_ID)
        Vehicles.remove(c, second.id)
        assertEquals(1, Vehicles.all(c).size)
        assertFalse(prefs.all.keys.any { it.endsWith("@${second.id}") })
    }

    @Test fun legacyKeysFromAnOldBackupGoToTheSelectedVehicle() {
        val second = Vehicles.add(c, "Segundo", "generic_obd2", null)
        Vehicles.select(c, second.id)
        prefs.edit(commit = true) { putFloat("fuel_level_l", 12f) }
        Vehicles.ensure(c, force = true)
        assertEquals(12.0, AppSettings.fuelLevel(c)!!, 1e-6)
    }
}
