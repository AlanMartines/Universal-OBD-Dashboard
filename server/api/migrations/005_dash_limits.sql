-- Escalas dos mostradores do app, para o painel abrir certo mesmo com o carro desligado.
ALTER TABLE devices ADD COLUMN dash_limits jsonb;
