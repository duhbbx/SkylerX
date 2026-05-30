# Éditeur SQL

## Ouvrir une page de requête

- ⌘T / Ctrl+T : nouvel onglet de requête
- Double-clic sur le nom d'une table → ouvre la grille de données par défaut (équivaut à `SELECT * FROM table LIMIT 200`)
- Clic droit sur une table → "Nouvelle requête", l'éditeur est pré-rempli avec `SELECT * FROM ...`

## Capacités de l'éditeur

Basé sur Monaco (le même que VS Code), avec un thème SQL par dialecte.

### Autocomplétion

`Ctrl+Space` ou déclenchement automatique lors de la frappe, complète :

- Mots-clés SQL / fonctions intégrées
- Tous les noms de bases / schemas de la connexion courante
- Noms des colonnes des tables déjà référencées dans FROM / JOIN
- Snippets SQL enregistrés (le nom du snippet sert de déclencheur)

### Formatage

⌘⇧F / Ctrl+Shift+F pour formater en un clic (basé sur sql-formatter). Supporte le style par dialecte (MySQL / PG / Oracle ont chacun leurs préférences).

### Paramétrage

Supporte les paramètres nommés `:name`. À l'exécution, une popup demande les valeurs :

```sql
SELECT * FROM orders
 WHERE user_id = :uid
   AND created_at >= :start
```

À l'exécution, la popup demande `uid` et `start` ; SkylerX convertit automatiquement vers la forme supportée par le driver (`?` ou `$1` etc.).

### Bibliothèque de snippets SQL

`⌘K → Snippets` ou panneau "Snippets" à gauche :

- Sauvegarder du SQL fréquent (nom + description + tags)
- Filtrer par tag
- Double-clic pour insérer dans l'éditeur courant, ou glisser-déposer dans n'importe quel onglet

## Exécution

| Raccourci | Action |
|---|---|
| ⌘+Enter / Ctrl+Enter | Exécute (la sélection seule si présente, sinon tout) |
| Bouton "Exécuter" de la barre d'outils | Idem |
| Barre d'outils "Annuler" | Annulation côté serveur (MySQL `KILL QUERY` / PG `pg_cancel_backend`) |

Les requêtes multiples sont automatiquement séparées par `;` et exécutées en séquence ; en cas d'échec, arrêt avec surlignage rouge de l'instruction fautive.

## Interception des risques par SQL Linter

Avant exécution, le moteur de règles tourne automatiquement :

| Sévérité | Règle | Action |
|---|---|---|
| error | UPDATE / DELETE sans WHERE | Popup de confirmation "SQL dangereux" |
| error | DROP TABLE / DATABASE sur connexion prod | Popup de confirmation |
| warn | TRUNCATE en prod | Avertissement toast |
| warn | FROM multi-tables sans ON | Toast |
| info | `SELECT *` | Trace console |
| info | SELECT sans LIMIT | Trace console |

**Le Lint prend précédence sur "double confirmation prod"** pour éviter qu'un UPDATE sans WHERE déclenche deux popups gênantes.

## Visualisation EXPLAIN

Bouton **Expliquer** de la barre d'outils (ou `EXPLAIN+` pour basculer en ANALYZE) :

- Affichage du plan d'exécution sous forme d'arbre
- Comparaison lignes estimées / réelles (mode ANALYZE)
- Coloration des opérateurs lents par durée : vert (< 100ms) / jaune (< 1s) / rouge (> 1s)
- Export en PNG / Markdown pour partage

## Complétion en ligne par IA (style Copilot)

Activée automatiquement une fois `Settings → AI Provider` configuré :

- Déclenchement après 600ms de pause du curseur
- Les requêtes en vol sont annulées immédiatement à un nouveau déclenchement
- Tab pour accepter, Esc/Backspace pour annuler
- Partage le même interrupteur que "autocomplétion SQL" (`Settings → Complétion`)

## Demander à l'IA en cas d'erreur

En cas d'échec d'exécution :

- La zone de résultat affiche l'erreur complète + SQLSTATE / errno
- Bouton "**✨ Demander à l'IA**" en haut → injecte le SQL courant + l'erreur + les métadonnées de connexion dans le panneau de chat IA et démarre automatiquement la conversation
- Tous les popups d'alerte ont aussi un bouton "Demander à l'IA"

## Historique des requêtes

`⌘K → Historique` ou panneau "Historique" à gauche :

- Tri chronologique inverse
- Affiche connexion / résumé SQL / durée / statut succès
- Double-clic pour rouvrir
- Favoris / recherche

## Favoris

Le bouton ⭐ ajoute le SQL courant aux favoris :

- Nom et tags personnalisés
- Utilisable inter-connexions
- Palette de commandes ⌘K → "Favoris" pour un accès rapide

## Gestion multi-onglets

- Clic milieu sur un onglet → ferme
- Clic droit → dupliquer / déplacer vers une autre fenêtre / épingler / fermer tous à droite
- Glisser pour réordonner
- Les onglets épinglés sont conservés après redémarrage de l'application
