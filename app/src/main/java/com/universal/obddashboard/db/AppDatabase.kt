package com.universal.obddashboard.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        TripEntity::class, TelemetryLogEntity::class, DiagnosticTroubleCodeEntity::class, FuelUpEntity::class, AiAnswerEntity::class,
        MaintenanceItemEntity::class, MaintenanceRecordEntity::class,
    ],
    version = AppDatabase.VERSION,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun tripDao(): TripDao

    abstract fun fuelUpDao(): FuelUpDao

    abstract fun aiAnswerDao(): AiAnswerDao

    abstract fun maintenanceDao(): MaintenanceDao

    companion object {
        const val NAME = "obd_blackbox.db"
        const val VERSION = 6

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

        /** v4: cada viagem, falha e abastecimento passa a ser de um veículo; o que já existe fica no primeiro. */
        val MIGRATION_3_4_SQL = listOf("trips", "diagnostic_trouble_codes", "fuel_ups").map {
            "ALTER TABLE `$it` ADD COLUMN `vehicle_id` TEXT NOT NULL DEFAULT 'v1'"
        }

        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) = MIGRATION_3_4_SQL.forEach { db.execSQL(it) }
        }

        /** v5: lembretes de manutenção (itens e registros de cada vez feita). O resto fica intacto. */
        val MIGRATION_4_5_SQL = listOf(
            "CREATE TABLE IF NOT EXISTS `maintenance_items` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `vehicle_id` TEXT NOT NULL, " +
                "`name` TEXT NOT NULL, `interval_km` REAL, `interval_months` INTEGER, `notes` TEXT, `created_at` INTEGER NOT NULL)",
            "CREATE INDEX IF NOT EXISTS `index_maintenance_items_vehicle_id` ON `maintenance_items` (`vehicle_id`)",
            "CREATE TABLE IF NOT EXISTS `maintenance_records` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `item_id` INTEGER NOT NULL, " +
                "`vehicle_id` TEXT NOT NULL, `timestamp` INTEGER NOT NULL, `odometer_km` REAL, `cost` REAL, `notes` TEXT)",
            "CREATE INDEX IF NOT EXISTS `index_maintenance_records_item_id` ON `maintenance_records` (`item_id`)",
            "CREATE INDEX IF NOT EXISTS `index_maintenance_records_vehicle_id` ON `maintenance_records` (`vehicle_id`)",
        )

        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) = MIGRATION_4_5_SQL.forEach { db.execSQL(it) }
        }

        /** v6: próxima troca anotada em cada item de manutenção (km e data). */
        val MIGRATION_5_6_SQL = listOf(
            "ALTER TABLE `maintenance_items` ADD COLUMN `next_km` REAL",
            "ALTER TABLE `maintenance_items` ADD COLUMN `next_at` INTEGER",
        )

        val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) = MIGRATION_5_6_SQL.forEach { db.execSQL(it) }
        }

        val ALL_MIGRATIONS = arrayOf(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6)

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
