-- Arquivos das notas passam a ser guardados por chave (caminho relativo), igual no disco e no S3.
-- Valores antigos tinham o caminho da pasta ("./storage/<id>/..." ou "/app/storage/<id>/...").
UPDATE "fiscal_documents" SET "file_path" = regexp_replace("file_path", '^(.*/)?storage/', '') WHERE "file_path" ~ '(^|/)storage/';
