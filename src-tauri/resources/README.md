# Resources Directory for Subaka Desktop

This directory holds bundled application resources, including `grammardb.sqlite3`.
During release packaging, placing `grammardb.sqlite3` here packages the full 2.01 million word Belarusian grammatical lexicon directly into the installer.

On startup, Subaka automatically checks:
1. `%LOCALAPPDATA%/Subaka/grammardb.sqlite3` or `~/Library/Application Support/Subaka/grammardb.sqlite3`
2. App bundle resource path (`resources/grammardb.sqlite3`)
3. Working directory (`./grammardb.sqlite3`)
4. `/tmp/grammardb.sqlite3`
