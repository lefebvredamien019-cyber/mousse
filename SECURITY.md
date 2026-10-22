# Sécurité MOUSSE — état et actions avant mise en production

Dernière revue : 2026-10-22.

## Corrections appliquées dans `index.html`

- Échappement HTML des champs de commandes réaffichés (nom, adresse, articles, statut, identifiant) pour réduire le risque d’injection HTML/XSS via les données locales.
- Validation de la liste des statuts autorisés lors d’une mise à jour de commande.
- Validation du format d’e-mail et limitation de longueur de certains champs de commande.
- Limites raisonnables sur le nom, le prix et le stock des produits de démonstration.
- Ajout de la politique de référent `strict-origin-when-cross-origin`.

## Limites critiques encore présentes

**Le site est encore un prototype front-end. Ne pas le présenter comme une plateforme de commandes réelle et sécurisée tant que ces points ne sont pas traités.**

1. Les profils, produits, commandes, demandes de gestion et préférences de thème sont conservés dans `localStorage`. Cela n’est ni une base partagée, ni une authentification, ni un contrôle d’accès. Chaque utilisateur peut modifier ces données depuis son navigateur.
2. Le panneau « Personnaliser » n’est pas protégé par une authentification. Masquer un bouton ou ajouter un code secret dans le JavaScript ne constituerait pas une sécurité.
3. Les commandes de démonstration ne sont pas transmises à un serveur. Ne pas y saisir de données personnelles réelles.
4. Le schéma Supabase fourni active RLS et limite les opérations aux propriétaires authentifiés, mais ne fournit pas à lui seul les politiques publiques nécessaires à la consultation des fiches/produits, ni le flux d’authentification front-end. Il faut tester les politiques dans un projet Supabase réel avant toute mise en service.
5. Le logo chargé depuis le dépôt privé `mousse-market-mate` peut ne pas être accessible publiquement. Copier le fichier logo dans le dépôt public MOUSSE (avec autorisation) ou utiliser une URL publique vérifiée.
6. Les en-têtes HTTP de sécurité (CSP, HSTS, X-Content-Type-Options, frame-ancestors, Permissions-Policy) doivent être configurés sur la plateforme d’hébergement/CDN. Une balise HTML ne remplace pas tous ces en-têtes. La CSP doit être testée en mode Report-Only avant activation, car le site utilise du JavaScript et des gestionnaires d’événements intégrés.
7. Aucune garantie de conformité légale (RGPD, obligations e-commerce, médiation, CGV, droit de rétractation, fiscalité, paiement) ne peut être déduite du code actuel. Faire vérifier le parcours et les mentions par un professionnel avant d’accepter de vraies commandes.

## Plan de sécurisation avant lancement

- [ ] Confirmer la plateforme d’hébergement et le domaine final.
- [ ] Configurer les en-têtes HTTP de sécurité sur l’hébergement et vérifier les réponses en production.
- [ ] Mettre en place Supabase Auth (confirmation e-mail, récupération de compte, MFA si disponible) et vérifier chaque rôle.
- [ ] Ajouter des politiques RLS minimales et testées : propriétaire uniquement pour les modifications; lecture publique uniquement des champs de boutique/produits explicitement publics; aucun accès public aux commandes et données client.
- [ ] Créer les commandes côté serveur avec validation des prix/stock et calcul du total côté serveur; ne jamais faire confiance aux totaux du navigateur.
- [ ] Ajouter limitation de débit, anti-abus et protection anti-spam pour les formulaires.
- [ ] Stocker les logos dans un bucket avec règles de stockage, taille/type vérifiés et noms de fichiers générés.
- [ ] Ajouter politique de confidentialité, durées de conservation, mécanisme d’exercice des droits et consentement adapté aux traceurs si utilisés.
- [ ] Tester sur mobile/ordinateur, navigation clavier, lecteur d’écran, erreurs réseau, stockage plein, données malformées et tentatives d’accès entre comptes.
- [ ] Ajouter des tests automatisés et un contrôle de dépendances dès qu’un processus de build/tests existe.

## Règle de sécurité

Ne jamais placer de clé Supabase `service_role`, mot de passe, jeton privé ou secret d’administration dans `index.html`, dans un dépôt public ou dans le stockage du navigateur. Seule la clé publique `anon/publishable` peut être exposée, avec RLS correctement configuré.
