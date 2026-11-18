# Encrypted website build

This repository holds only the published build of a private, password-protected website,
served with GitHub Pages from the `main` branch. Every page is encrypted with
[StatiCrypt](https://github.com/robinmoisson/staticrypt) (AES-256) before it is pushed,
so nothing in it can be read without the password. The source is kept in a private repository.
Search engines are blocked (robots.txt and noindex).

This `watcher` branch only holds a small workflow that asks the private repository to
rebuild the site when its task list has changed. It prints nothing about the content.
