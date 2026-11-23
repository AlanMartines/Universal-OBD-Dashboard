-- Tema, dia/noite e cor dos mostradores escolhidos no app, para o painel web abrir igual.
ALTER TABLE devices ADD COLUMN dash_prefs jsonb;
