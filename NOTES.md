Changes:
• Populated [grammars/beast](/Users/xpriori/Code/beast/grammars/beast) with grammar.js,
tree-sitter.json, src/scanner.c, src/parser.c (+ grammar.json etc.)
• git init -b main in grammars/beast, committed ed51a01, set
[extension.toml](/Users/xpriori/Code/beast/extension.toml:18) to:
[grammars.beast]
repository = "file:///Users/xpriori/Code/beast/grammars/beast"
rev = "ed51a0171b72696fbc929071fe7b948e632bcc4e"

Retry install:
Cmd+Shift+P → zed: install dev extension → select /Users/xpriori/Code/beast again.

It should now log compiling grammar beast → success (wasi-sdk already cached). If you edit the grammar
later, re-run bunx tree-sitter generate at root, copy to grammars/beast/ (
cp grammar.cjs grammar.js src/* grammars/beast/), git -C grammars/beast commit -am "update", and
update rev in extension.toml to the new git rev-parse HEAD.

For publishing to zed-industries/extensions, switch repository back to your public git URL (e.g.
https://github.com/your-org/tree-sitter-beast) and rev to that repo's SHA.
