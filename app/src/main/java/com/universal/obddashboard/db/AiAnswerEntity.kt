package com.universal.obddashboard.db

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query

/**
 * Última resposta do assistente IA para um assunto, para rever sem pagar a consulta de novo:
 * kind "trip" (ref = id da viagem) ou "dtc" (ref = código, ex.: P0420).
 */
@Entity(tableName = "ai_answers", indices = [Index(value = ["kind", "ref"], unique = true)])
data class AiAnswerEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val kind: String,
    val ref: String,
    val text: String,
    val model: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
)

@Dao
interface AiAnswerDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun save(a: AiAnswerEntity): Long

    @Query("SELECT * FROM ai_answers WHERE kind = :kind AND ref = :ref")
    suspend fun get(kind: String, ref: String): AiAnswerEntity?

    @Query("DELETE FROM ai_answers WHERE kind = :kind AND ref = :ref")
    suspend fun delete(kind: String, ref: String)

    /** Apaga as respostas de um tipo, exceto a do assunto [keepRef] (ex.: a viagem em andamento). */
    @Query("DELETE FROM ai_answers WHERE kind = :kind AND ref != :keepRef")
    suspend fun deleteKindExcept(kind: String, keepRef: String)

    @Query("DELETE FROM ai_answers")
    suspend fun deleteAll()
}
