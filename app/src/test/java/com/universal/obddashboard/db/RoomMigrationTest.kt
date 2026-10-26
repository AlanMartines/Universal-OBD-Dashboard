package com.universal.obddashboard.db

import androidx.room.Room
import androidx.room.testing.MigrationTestHelper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * Migração de verdade (SQLite no Robolectric): cria o banco na v1 com uma viagem, telemetria e
 * falha, migra até a versão atual e confere que nada se perdeu e que o Room aceita o esquema.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class RoomMigrationTest {

    private val name = "migration-test.db"

    @get:Rule val helper = MigrationTestHelper(InstrumentationRegistry.getInstrumentation(), AppDatabase::class.java)

    @Test fun v1DataSurvivesAllMigrations() {
        helper.createDatabase(name, 1).use { db ->
            db.execSQL("INSERT INTO trips (id, profile_id, start_time, end_time, distance_km, max_speed_kmh, max_rpm, fuel_used_l) VALUES (1, 'p', 1000, 2000, 418.0, 120.0, 4500.0, 32.2)")
            db.execSQL("INSERT INTO telemetry_log (trip_id, timestamp, rpm, speed_obd_kmh, latitude, longitude) VALUES (1, 1500, 3000.0, 100.0, -20.5, -54.6)")
            db.execSQL("INSERT INTO diagnostic_trouble_codes (trip_id, code, kind, detected_at) VALUES (1, 'P0420', 'CONFIRMED', 1600)")
        }
        // Valida cada passo contra o esquema exportado
        helper.runMigrationsAndValidate(name, 2, true, AppDatabase.MIGRATION_1_2).close()
        helper.runMigrationsAndValidate(name, 3, true, AppDatabase.MIGRATION_2_3).close()

        // E o app abre o banco migrado com as migrações que usa de fato
        val db = Room.databaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java, name)
            .addMigrations(*AppDatabase.ALL_MIGRATIONS)
            .allowMainThreadQueries()
            .build()
        try {
            runBlocking {
                val trip = db.tripDao().getTrip(1)!!
                assertEquals(418.0, trip.distanceKm, 0.0)
                assertEquals(1, db.tripDao().telemetryForTrip(1).size)
                val dtc = db.tripDao().dtcsForTrip(1).single()
                assertEquals("P0420", dtc.code)
                assertNull(dtc.ecuFreezeJson)
                assertEquals(0, db.fuelUpDao().all().size)
                db.tripDao().setEcuFreeze(1, "P0420", "{\"code\":\"P0420\"}")
                assertEquals("{\"code\":\"P0420\"}", db.tripDao().dtcsForTrip(1).single().ecuFreezeJson)
                db.aiAnswerDao().save(AiAnswerEntity(kind = "trip", ref = "1", text = "a", createdAt = 1))
                db.aiAnswerDao().save(AiAnswerEntity(kind = "trip", ref = "1", text = "b", createdAt = 2))
                assertEquals("b", db.aiAnswerDao().get("trip", "1")!!.text)
            }
        } finally {
            db.close()
        }
    }
}
