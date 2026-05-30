# Grille de résultats

Après exécution d'un SQL, les résultats s'affichent dans la zone de grille en bas.

## Pagination + défilement virtuel

- 200 lignes par page par défaut, modifiable dans `Settings → Taille de page par défaut`
- Pour les grands résultats (> 10000 lignes), le **défilement virtuel** s'active automatiquement : seules les lignes visibles sont rendues, défilement fluide même sur 1 million de lignes
- Pagineur en bas : première / précédent / suivant / dernière + champ de saut

## Mode édition

Les résultats de `SELECT` mono-table sont éditables par défaut (désactivé si JOIN / agrégation détecté) :

### Modifier une cellule

- **Double-clic sur une cellule** → entre immédiatement en édition (focus automatique + texte existant sélectionné, taper écrase directement)
- Le champ de saisie épouse strictement la cellule, WYSIWYG
- Enter pour valider / Esc pour annuler
- Les cellules modifiées sont surlignées comme dirty

### Ajouter une ligne

- Barre d'outils "➕ Nouvelle ligne" ou frappe directe dans la ligne vide en bas de la grille
- Édition multi-colonnes : Tab pour passer à la colonne suivante
- Colonne PK laissée vide → valeur par défaut / auto-increment

### Supprimer des lignes

- Cocher les lignes (multi-sélection) → barre d'outils "🗑 Supprimer la sélection"
- Marquage dirty rouge pour la ligne entière

### Annuler / Valider

- "↺ Annuler" restaure toutes les modifications non validées
- "✓ Valider" ouvre la boîte de dialogue "Prévisualisation SQL" :
  ```sql
  UPDATE users SET email='new@x.com' WHERE id=42;
  INSERT INTO users (name, email) VALUES ('Bob', 'bob@x.com');
  DELETE FROM users WHERE id=99;
  ```
- Après confirmation, **commit transactionnel global** ; en cas d'échec, ROLLBACK automatique, les annulations ne sont pas perdues

## Rendu visuel des cellules

- **NULL** → fond gris avec texte `NULL`
- **Chaîne vide** → placeholder gris clair `''`
- **Texte long** → tronqué avec ellipsis + tooltip
- **JSON** → police monospace + coloration (objets / tableaux / littéraux)
- **BLOB** → reconnaissance automatique d'image (en-têtes PNG / JPEG / GIF / WEBP), sinon `<BLOB N bytes>` + aperçu hex
- **Colonnes numériques** → sparkline ajoutée automatiquement en en-tête (tendance des données de la page)
- **Cellules NULL / grands nombres** → coloration conditionnelle par défaut (désactivable dans Settings)

## Opérations sur les colonnes

### Menu contextuel d'en-tête

- Copier le nom de colonne
- Trier ascendant / descendant / annuler
- Masquer / afficher
- Ajouter un filtre
- Ajouter une référence (si FK, JOIN vers la table référencée pour afficher une colonne supplémentaire)

### Largeur de colonne

Glisser la limite d'en-tête pour ajuster ; **double-clic sur la limite** pour s'adapter automatiquement au contenu.

## Filtrage

Bouton 🔍 de la barre d'outils ou menu contextuel d'en-tête → ajouter un filtre, supporte :

- Chaînes : contains / startsWith / regex
- Nombres : `= != < > between`
- Dates : plage
- Booléens : coché / décoché
- NULL : `IS NULL` / `IS NOT NULL`

Cumul multi-colonnes en AND ; **filtre multi-valeurs style Excel** : cliquer ⋯ en haut à droite de l'en-tête → liste cochable des valeurs distinctes.

## Tri

- Clic sur l'en-tête : ascendant → descendant → annulé
- Tri multi-colonnes : maintenir Shift et cliquer en séquence

## Copie

Sélection → ⌘C / Ctrl+C → copie (TSV par défaut).

Barre d'outils "Copier en" :
- CSV
- TSV
- Tableau JSON
- Tableau Markdown
- SQL `VALUES (...)` (à coller dans un INSERT)
- SQL `INSERT INTO ...` (instructions INSERT complètes)

## Export

Bouton "Exporter" de la barre d'outils → dialogue de sélection du format :

- **CSV / TSV** — séparateurs de ligne / champ personnalisables
- **JSON / NDJSON** — tableau / un document par ligne
- **Excel .xlsx** — écriture SheetJS native, formules / styles préservés
- **Markdown / HTML** — tableau + style optionnel
- **SQL INSERT** — pratique pour migrer toute la table vers une autre base
- **.skbk chiffré** (expérimental) — AES-256-GCM + PBKDF2, **données protégées à la sortie**

## Saut sur clé étrangère

- Clic droit sur cellule → "Aller à la ligne référencée" — localise automatiquement la table référencée + condition WHERE
- Clic droit sur cellule → "Voir les références inverses" — quelles tables / lignes référencent cette valeur

## Menu contextuel des cellules — Demander à l'IA / Rechercher la valeur

Clic droit sur chaque cellule :

- Copier
- Aller à la ligne référencée / Voir les références inverses
- **Rechercher cette valeur dans toutes les tables** — voir si cette valeur apparaît ailleurs dans la base
- **Demander à l'IA** — envoie l'erreur ou la donnée anormale sélectionnée à l'IA pour analyse

## Vues multiples

Basculement de vue en haut à droite de la barre d'outils :

- **Grille** (par défaut)
- **JSON** (JSON brut, pratique pour le debug)
- **Formulaire** (pour une ligne unique multi-colonnes, édition verticale label-value)
- **Tableau croisé dynamique**
- **Arbre FK auto-référencé** (données hiérarchiques comme commentaires / départements)
- **Nuage de points géographique** (détection auto des colonnes latitude/longitude)
- **Frise chronologique** (colonne temporelle + numérique → ligne / barres)
- **Graphique** (barre / ligne / camembert, exportable en PNG)
