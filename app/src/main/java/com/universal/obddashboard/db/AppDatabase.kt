package com.universal.obddashboard.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [TripEntity::class, TelemetryLogEntity::class, DiagnosticTroubleCodeEntity::class, FuelUpEntity::class, AiAnswerEntity::class],
    version = AppDatabase.VERSION,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun tripDao(): TripDao

    abstract fun fuelUpDao(): FuelUpDao

    abstract fun aiAnswerDao(): AiAnswerDao

    companion object {
        const val NAME = "obd_blackbox.db"
        const val VERSION = 3

        @Volatile private var instance: AppDatabase? = null

        /** v2: tabela de abastecimentos. Viagens, telemetria e falhas ficam intactas. */
        val MIGRATION_1_2_SQL = listOf(
            "CREATE TABLE IF NOT EXISTS `fuel_ups` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `timestamp` INTEGER NOT NULL, " +
                "`profile_id` TEXT NOT NULL, `odometer_km` REAL, `liters` REAL NOT NULL, `total_price` REAL, `price_per_liter` REAL, " +
                "`fuel_type` TEXT NOT NULL, `ethanol_pct` REAL, `full_tank` INTEGER NOT NULL, `station` TEXT, `notes` TEXT)",
            "CREATE INDEX IF NOT EXISTS `index_fuel_ups_timestamp` ON `fuel_ups` (`timestamp`)",
        )

        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) = MIGRATION_1_2_SQL.forEach { db.execSQL(it) }
        }

        /** v3: congelamento de quadro da ECU nas falhas e respostas guardadas do assistente IA. */
        const val MIGRATION_2_3_ALTER = "ALTER TABLE `diagnostic_trouble_codes` ADD COLUMN `ecu_freeze_json` TEXT"
        val MIGRATION_2_3_CREATE = listOf(
            "CREATE TABLE IF NOT EXISTS `ai_answers` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `kind` TEXT NOT NULL, " +
                "`ref` TEXT NOT NULL, `text` TEXT NOT NULL, `model` TEXT, `created_at` INTEGER NOT NULL)",
            "CREATE UNIQUE INDEX IF NOT EXISTS `index_ai_answers_kind_ref` ON `ai_answers` (`kind`, `ref`)",
        )

        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(MIGRATION_2_3_ALTER)
                MIGRATION_2_3_CREATE.forEach { db.execSQL(it) }
            }
        }

        val ALL_MIGRATIONS = arrayOf(MIGRATION_1_2, MIGRATION_2_3)

        /** Fecha o banco para o backup ser restaurado; o próximo [get] reabre (e migra, se preciso). */
        fun closeForRestore() = synchronized(this) {
            instance?.close()
            instance = null
        }

        fun get(context: Context): AppDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, NAME)
                    .setJournalMode(JournalMode.WRITE_AHEAD_LOGGING)
                    .addMigrations(*ALL_MIGRATIONS)
                    .build()
                    .also { instance = it }
            }
    }
}
