# Grade de resultados

Após executar um SQL, o resultado é exibido na área da grade abaixo.

## Paginação + rolagem virtual

- Padrão de 200 linhas por página, ajustável em `Settings → Tamanho de página padrão`
- Resultados grandes (> 10000 linhas) ativam **rolagem virtual** automaticamente: apenas a área visível é renderizada, rolando 1 milhão de linhas sem travar
- Paginador no rodapé: primeira / anterior / próxima / última + caixa para pular

## Modo edição

Resultados de `SELECT` de uma única tabela são editáveis por padrão (desabilitado ao detectar JOIN / agregação):

### Alterar célula

- **Duplo clique na célula** → entra imediatamente em modo edição (cursor focado + texto existente selecionado, basta digitar para sobrescrever)
- O input se ajusta perfeitamente à largura/altura da célula, WYSIWYG
- Enter confirma / Esc sai
- Células alteradas ganham cor de fundo indicando dirty

### Adicionar linha

- Botão "➕ Adicionar linha" na toolbar ou digite na linha vazia no rodapé
- Edição de múltiplas colunas: Tab para a próxima coluna
- Colunas PK em branco → valor default do DB / autoincremento

### Remover linha

- Marque as linhas (multi-seleção) → "🗑 Excluir selecionadas" na toolbar
- Linha inteira marcada como dirty em vermelho

### Desfazer / commitar

- "↺ Desfazer" restaura todas as alterações não commitadas
- "✓ Commit" abre o diálogo "Preview SQL":
  ```sql
  UPDATE users SET email='new@x.com' WHERE id=42;
  INSERT INTO users (name, email) VALUES ('Bob', 'bob@x.com');
  DELETE FROM users WHERE id=99;
  ```
- Após confirmação do usuário, **commit em transação única**; em caso de falha, ROLLBACK automático e o desfazer não é perdido

## Visual das células

- **NULL** → fundo cinza com texto `NULL`
- **String vazia** → placeholder `''` em cinza claro
- **Texto longo** → truncado com reticências no final + tooltip
- **JSON** → fonte monoespaçada + colorização (objeto / array / literal)
- **BLOB** → reconhecimento automático de imagem (cabeçalhos PNG / JPEG / GIF / WEBP), senão exibe `<BLOB N bytes>` + preview em hex
- **Colunas numéricas** → cabeçalho ganha uma mini sparkline automaticamente (mostra tendência da página)
- **Células null / números grandes** → coloração condicional por padrão (desativável em Settings)

## Operações em colunas

### Menu de contexto do cabeçalho

- Copiar nome da coluna
- Ordenar crescente / decrescente / cancelar ordenação
- Esconder / mostrar
- Adicionar filtro
- Adicionar campo referenciado (se for FK, puxa uma coluna da tabela referenciada para exibir junto)

### Largura da coluna

Arraste a borda do cabeçalho para ajustar; **duplo clique na borda** auto-ajusta ao conteúdo.

## Filtros

Botão 🔍 na toolbar ou clique direito no cabeçalho → Adicionar filtro, suporta:

- Strings: contains / startsWith / regex
- Números: `= != < > between`
- Datas: intervalo
- Booleanos: marca / desmarca
- NULL: `IS NULL` / `IS NOT NULL`

Múltiplas colunas se combinam com AND; **filtro multi-valor estilo Excel**: clique no ⋯ no canto superior direito do cabeçalho → exibe lista de valores distintos para marcar.

## Ordenação

- Clique no cabeçalho: crescente → decrescente → cancelar
- Ordenação por múltiplas colunas: segure Shift e clique em sequência

## Copiar

Selecione a área → ⌘C / Ctrl+C → copia (TSV por padrão).

"Copiar como" na toolbar:
- CSV
- TSV
- Array JSON
- Tabela Markdown
- SQL `VALUES (...)` (fácil de colar em INSERT)
- SQL `INSERT INTO ...` (statement de inserção completo)

## Exportar

Botão "Exportar" na toolbar → abre o diálogo de seleção de formato:

- **CSV / TSV** — separadores de linha / campo customizáveis
- **JSON / NDJSON** — array / um documento por linha
- **Excel .xlsx** — gerado com SheetJS real, fórmulas / estilos preservados
- **Markdown / HTML** — tabela + estilos opcionais
- **SQL INSERT** — facilita migração completa de dados entre bancos
- **.skbk criptografado** (experimental) — AES-256-GCM + PBKDF2, **dados saem com cadeado**

## Salto por chave estrangeira

- Clique direito na célula → "Ir para linha referenciada" — localiza automaticamente a tabela referenciada + WHERE
- Clique direito na célula → "Ver referências reversas" — quais tabelas / linhas referenciam o valor atual

## Menu de contexto da célula — Perguntar à IA / busca cross-table

Em cada célula, clique direito:

- Copiar
- Ir para linha referenciada / ver referências reversas
- **Buscar este valor em outras tabelas** — verifica se aparece em outros lugares do banco
- **Perguntar à IA** — envia o erro ou dado anômalo selecionado para análise da IA

## Múltiplas visualizações

Seletor de visualização no canto superior direito da toolbar:

- **Grade** (padrão)
- **JSON** (JSON bruto, ideal para depuração)
- **Formulário** (para linhas únicas com muitas colunas, edição em formato label-value vertical)
- **Tabela dinâmica (pivot)**
- **Árvore FK auto-referenciada** (dados pai-filho, ex.: comentários / departamentos)
- **Scatter geográfico** (colunas lat/lng detectadas automaticamente)
- **Linha do tempo** (coluna de tempo + coluna numérica → linha / barras)
- **Gráficos** (barras / linhas / pizza, exportáveis como PNG)
