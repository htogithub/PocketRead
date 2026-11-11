# PocketRead

Dépose une image, un PDF ou une capture d’écran : PocketRead en extrait le texte et te le lit à voix haute, avec le mot en cours surligné.

Tout tourne dans le navigateur : la reconnaissance du texte (Tesseract.js), la lecture des PDF (pdf.js) et les voix IA locales (modèles Piper via ONNX Runtime Web). Le texte ne quitte jamais l’appareil et rien n’est enregistré.

## Mise en ligne (GitHub Pages)

1. Crée un dépôt et pousse tous les fichiers de ce dossier à la racine (`index.html`, `styles.css`, `app.js`, `piper-worker.js`, `sw.js`, `manifest.webmanifest`, `icons/`).
2. Settings › Pages › Deploy from a branch › `main` / `root`.
3. Ouvre l’URL `https://<utilisateur>.github.io/<dépôt>/`, puis sur iPhone : Partager › Sur l’écran d’accueil.

L’app doit être servie en HTTPS (GitHub Pages le fait) : les voix IA, le cache hors-ligne et le presse-papiers en ont besoin.

## Voix

- **Voix de l’appareil** : instantanées et hors-ligne. Les plus réalistes sont les voix « Natural » de Microsoft Edge et les voix « Premium » d’Apple (à télécharger dans Réglages › Accessibilité › Contenu énoncé › Voix).
- **Voix IA locale** : voix neuronales Piper (FR, EN, DE) calculées sur l’appareil. Chaque voix se télécharge une fois (≈ 20 à 60 Mo) puis fonctionne hors-ligne.

## Raccourcis clavier

Espace : lecture/pause · ← → : phrase · Maj + ← → : paragraphe · + − : vitesse · F : mode focus · V : réglages de la voix
