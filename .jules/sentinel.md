
## $(date +%Y-%m-%d) - HelpPanel XSS Vulnerability
**Vulnerability:** The HelpPanel used `innerHTML` directly to inject raw markdown output.
**Learning:** Even static documentation should be treated cautiously if it gets evaluated via `innerHTML`. Relying purely on markdown parsing logic for safety is fragile because it is easy to accidentally parse and inject malicious HTML like `<img src="x" onerror="alert(1)">`. SolidJS strictly forbids this via `solid/no-innerhtml`.
**Prevention:** Always use `DOMPurify` (or an equivalent sanitization library) to explicitly sanitize any string before assigning it to `innerHTML`, even if the string is generated from a seemingly safe source.

## 2025-05-24 - [Fix XSS via Language Attribute Injection in Fenced Code Blocks]
**Vulnerability:** The markdown renderer allowed injecting arbitrary HTML attributes into fenced code block `<code>` tags because the `lang` variable was not escaped before string interpolation (`<code class="language-${lang}">`). A payload like ```` ```html"><script>alert(1)</script> ```` successfully broke out of the attribute.
**Learning:** Variables obtained directly from unsanitized input must always be restricted before insertion into HTML string templates. Escaping alone is insufficient — a whitelist that limits the value to known-safe characters is more robust and prevents class pollution from spaces or unusual characters.
**Prevention:** Restrict extracted identifiers to a strict character whitelist (e.g. `match(/^[a-zA-Z0-9_\-+#.]+/)`) before interpolating into HTML attributes, rather than relying solely on HTML-entity escaping.

## 2025-05-24 - [Fix Improper URL Validation in isSafeUrl]
**Vulnerability:** The regex `/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i` in `isSafeUrl` permitted malformed pseudo-protocols (e.g., `https:javascript:alert(1)`) to pass validation. Also, `isSafeUrl` correctly performed a `.trim()` check to validate URLs without leading whitespaces, but then returned the original, untrimmed URL which could still evaluate unsafely.
**Learning:** Security validations using regex must ensure the correct scheme boundary exists (e.g., `https?:\/\/` instead of just `https?:`). Validating the trimmed version of an input and then returning the untrimmed version allows malicious whitespace patterns to bypass intended constraints.
**Prevention:** When matching protocols in regex, strictly require `//` for HTTP/HTTPS protocols. When performing input validation, use and return the mutated (e.g. trimmed) string rather than evaluating the mutated form but returning the original.
