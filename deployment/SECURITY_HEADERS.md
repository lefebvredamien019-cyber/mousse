# En-têtes HTTP de sécurité — MOUSSE

L'hébergeur du site n'étant pas confirmé, **ne copiez pas tous les exemples à la fois**. Choisissez uniquement la configuration correspondant à l'hébergeur réel, puis vérifiez les réponses HTTP sur le domaine déployé.

## En-têtes de départ

À configurer au niveau de l'hébergement/CDN :

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY` (si le site ne doit jamais être intégré dans une iframe)
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Content-Security-Policy` : à déployer d'abord en mode Report-Only et à ajuster après inventaire des scripts, styles, images et connexions nécessaires.
- `Strict-Transport-Security` : seulement après confirmation que le domaine fonctionne intégralement en HTTPS. Ne pas activer `includeSubDomains` ou `preload` sans vérifier tous les sous-domaines.

Le site actuel contient du JavaScript et des styles intégrés. Une CSP stricte ajoutée sans adaptation peut casser des fonctionnalités. Ne pas utiliser `unsafe-eval`; éviter `unsafe-inline` comme solution permanente. Préférer ensuite des scripts/styles externes avec nonce ou hash adaptés à l'hébergement.

## Netlify / Cloudflare Pages

Créer un fichier `_headers` à la racine du dossier publié. Exemple de départ (sans CSP ni HSTS, à compléter après vérification) :

```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Vérifier que le dossier contenant `_headers` est bien celui publié. Les règles `_headers` ne sont pas prises en charge par tous les hébergeurs.

## Vercel

Créer `vercel.json` à la racine avec une règle `headers` pour toutes les routes. Ne pas créer ce fichier si le site n'est pas hébergé sur Vercel.

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
      ]
    }
  ]
}
```

## Vérifications à faire après déploiement

1. Vérifier que chaque URL redirige vers HTTPS.
2. Inspecter les en-têtes de la réponse HTTP, pas seulement le HTML.
3. Vérifier les parcours principaux après chaque en-tête ajouté.
4. Examiner les rapports CSP, puis passer de Report-Only à Enforcement uniquement quand les violations légitimes sont résolues.
5. Refaire les vérifications après changement d'hébergeur ou de domaine.

## Limites

Ces exemples ne sont pas encore appliqués au site déployé. Ils ne remplacent ni Supabase Auth, ni les grants/RLS, ni les validations côté serveur. Ne pas y ajouter de clé Supabase secrète.
