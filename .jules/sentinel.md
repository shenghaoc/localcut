
## $(date +%Y-%m-%d) - HelpPanel XSS Vulnerability
**Vulnerability:** The HelpPanel used `innerHTML` directly to inject raw markdown output.
**Learning:** Even static documentation should be treated cautiously if it gets evaluated via `innerHTML`. Relying purely on markdown parsing logic for safety is fragile because it is easy to accidentally parse and inject malicious HTML like `<img src="x" onerror="alert(1)">`. SolidJS strictly forbids this via `solid/no-innerhtml`.
**Prevention:** Always use `DOMPurify` (or an equivalent sanitization library) to explicitly sanitize any string before assigning it to `innerHTML`, even if the string is generated from a seemingly safe source.
