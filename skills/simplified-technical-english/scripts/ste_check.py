#!/usr/bin/env python3
"""
ste_check.py — mechanical linter for ASD-STE100 Simplified Technical English.

Flags what can be detected mechanically. It CANNOT judge whether a rewrite still
means the same thing, whether vocabulary is consistent across a product, or whether
the register suits the context. A clean run is not a conformance certificate.

Usage:
    ste_check.py FILE [FILE...]        # .json (i18n), .md, .txt, .html, source files
    ste_check.py --text "some string"
    ste_check.py --json FILE           # machine-readable output
    ste_check.py --procedural FILE     # treat all text as instructions (20-word limit)

Exit status: 0 clean, 1 findings, 2 usage error.
"""
import sys, os, re, json, argparse
from html.parser import HTMLParser

MAX_PROC, MAX_DESC, MAX_PARA_SENT, MAX_NOUN_CLUSTER = 20, 25, 6, 3

# ── vocabulary ───────────────────────────────────────────────────────────────
SUBS = {
    "utilize": "use", "utilise": "use", "utilizes": "uses", "utilized": "used",
    "accomplish": "do", "perform": "do", "execute": "do", "implement": "do",
    "initiate": "start", "commence": "start", "activate": "start",
    "terminate": "stop", "cease": "stop", "halt": "stop", "deactivate": "stop",
    "obtain": "get", "acquire": "get", "procure": "get", "receive": "get",
    "provide": "give", "supply": "give", "furnish": "give",
    "require": "need", "requires": "needs", "required": "needed",
    "permit": "let", "assist": "help", "attempt": "try", "endeavour": "try",
    "modify": "change", "alter": "change", "amend": "change",
    "eliminate": "remove", "verify": "check", "ensure": "make sure",
    "confirm": "check", "indicate": "show", "indicates": "shows",
    "demonstrate": "show", "rotate": "turn", "locate": "find",
    "ascertain": "find out", "facilitate": "help", "construct": "build",
    "transmit": "send", "retain": "keep", "monitor": "watch",
    "approximately": "about", "sufficient": "enough", "additional": "more",
    "numerous": "many", "initial": "first", "subsequent": "next",
    "previous": "last", "optimal": "best", "adequate": "enough",
    "adjacent": "next to", "appropriate": "correct", "applicable": "correct",
    "utilization": "use", "termination": "end", "notification": "message",
    "authorization": "permission", "configuration": "settings",
    "capability": "can", "functionality": "function", "assistance": "help",
    "modification": "change", "verification": "check", "requirement": "need",
    "prior": "before", "subsequently": "after", "furthermore": "also",
    "moreover": "also", "however": "but", "nevertheless": "but",
    "therefore": "so", "consequently": "so", "hence": "so",
    "notwithstanding": "but", "aforementioned": "this",
    "essentially": "(delete)", "basically": "(delete)", "fundamentally": "(delete)",
    "simply": "(delete)", "very": "(delete)", "quite": "(delete)",
    "rather": "(delete)", "fairly": "(delete)", "please": "(delete)",
    "sorry": "(delete)", "oops": "(delete)", "successfully": "(delete)",
    "invalid": "(say what is wrong and what is valid)",
    "unable": "cannot", "etc": "(finish the list)",
}
PHRASES = {
    r"\bprior to\b": "before", r"\bsubsequent to\b": "after",
    r"\bin order to\b": "to", r"\bso as to\b": "to",
    r"\bdue to the fact that\b": "because", r"\bowing to the fact that\b": "because",
    r"\bin the event (?:that|of)\b": "if", r"\bwith regard to\b": "about",
    r"\bwith respect to\b": "about", r"\bin addition\b": "also",
    r"\bby means of\b": "with", r"\bin conjunction with\b": "with",
    r"\bin accordance with\b": "follow", r"\bin the absence of\b": "without",
    r"\bin excess of\b": "more than", r"\ba minimum of\b": "at least",
    r"\ba maximum of\b": "no more than", r"\bat this point in time\b": "now",
    r"\bin a timely manner\b": "quickly", r"\bin the vicinity of\b": "near",
    r"\bclose to\b": "near", r"\ba number of\b": "some",
    r"\bthe majority of\b": "most", r"\bsomething went wrong\b": "(name the failure)",
    r"\ban error occurred\b": "(name the error and what to do)",
    r"\bare you sure\b": "(state the consequence, then ask)",
    r"\bclick here\b": "(name the destination)", r"\band/or\b": "(pick one)",
    r"\bas appropriate\b": "(state the condition)",
    r"\bif applicable\b": "(state the condition)",
    r"\bwhere necessary\b": "(state the condition)",
}
AMBIGUOUS_MODALS = {"should": "decide: 'must', or 'we recommend that you'",
                    "may": "decide: 'can', or 'it is possible that'",
                    "shall": "use 'must'", "would": "use the simple present",
                    "could": "use 'can', or name the condition"}

# -ing words that are legitimate technical nouns / modifiers, not gerunds
ING_OK = {
    "setting", "settings", "landing", "bearing", "housing", "casing", "wiring",
    "tubing", "coupling", "fitting", "spring", "string", "thing", "something",
    "nothing", "everything", "anything", "during", "morning", "evening",
    "meeting", "building", "warning", "heading", "listing", "mapping",
    "logging", "tracking", "billing", "onboarding", "branding", "training",
    "ring", "king", "wing", "being", "ceiling", "engineering", "marketing",
    "accounting", "banking", "shipping", "packaging", "reading", "writing",
    "staging", "casting", "forging", "tooling", "sampling", "rounding",
}
# transient status labels where -ing is permitted (see SKILL.md collisions)
ING_STATUS = re.compile(r"^\s*[A-Z][a-z]+ing(\s+\S+){0,2}\s*[.…]{0,3}\s*$")

BE = r"(?:is|are|was|were|be|been|being|am)"
PASSIVE = re.compile(rf"\b{BE}\s+(?:\w+ly\s+)?(\w+(?:ed|en))\b", re.I)
PASSIVE_OK = {"used", "based", "needed", "related", "limited", "detailed",
              "advanced", "interested", "pleased", "allowed", "supposed"}
CONTRACTIONS = re.compile(r"\b\w+(?:'|\u2019)(?:s|t|re|ve|ll|d|m)\b", re.I)
NOUNISH = re.compile(r"^[a-z][a-z0-9-]*$")
STOPWORDS = {"the","a","an","and","or","but","if","of","to","in","on","at","for",
             "with","from","by","as","is","are","was","were","be","this","that",
             "these","those","you","your","it","its","we","our","not","do","does",
             "can","will","must","when","then","than","also","all","any","each",
             "no","yes","so","up","out","off","over","under","more","most","use",
             # quantifiers, ordinals and participles are not nouns — without these
             # the cluster heuristic fires on things like "at least one special
             # character", which is ordinary English, not a noun stack.
             "least","one","two","three","four","five","six","first","second",
             "next","last","other","others","same","own","such","only","both",
             "few","many","much","several","every","including","included",
             "before","after","between","above","below","new","old","other",
             "least","per","via","into","onto","within","without","about"}
PLACEHOLDER = re.compile(r"(\{[^}]*\}|%[sd]|%\d+\$[sd]|\$\{[^}]*\}|<[^>]+>|:\w+)")
CODEISH = re.compile(r"^[\s]*(?:[A-Za-z_$][\w$]*\.)+[A-Za-z_$][\w$]*[\s]*$")


def sentences(text):
    parts = re.split(r"(?<=[.!?])[\s\u00a0]+(?=[A-Z\"'(])", text.strip())
    return [p.strip() for p in parts if p.strip()]


def words(s):
    s = PLACEHOLDER.sub(" X ", s)
    return re.findall(r"[A-Za-z][A-Za-z'-]*", s)


def noun_clusters(s):
    """Runs of >3 consecutive lowercase nounish tokens with no function word."""
    toks = re.findall(r"[A-Za-z][A-Za-z-]*", s)
    run, out = [], []
    for t in toks:
        if NOUNISH.match(t) and t.lower() not in STOPWORDS:
            run.append(t)
        else:
            if len(run) > MAX_NOUN_CLUSTER:
                out.append(" ".join(run))
            run = []
    if len(run) > MAX_NOUN_CLUSTER:
        out.append(" ".join(run))
    return out


def check_string(text, loc, procedural=None, findings=None):
    f = findings if findings is not None else []
    if not text or not text.strip() or CODEISH.match(text):
        return f
    add = lambda rule, msg, sev="warn": f.append(
        {"loc": loc, "rule": rule, "severity": sev, "message": msg,
         "text": text[:120]})

    stripped = PLACEHOLDER.sub("X", text)
    sents = sentences(stripped)

    # paragraph length
    if len(sents) > MAX_PARA_SENT:
        add("4.2", f"{len(sents)} sentences in one block; limit is {MAX_PARA_SENT}")

    for s in sents:
        w = words(s)
        n = len(w)
        imperative = bool(re.match(r"^(?:Do not|Don't|[A-Z][a-z]+)\b", s)) and \
            not re.match(r"^(?:The|This|That|These|Those|Your|You|It|We|A|An)\b", s)
        proc = imperative if procedural is None else procedural
        limit = MAX_PROC if proc else MAX_DESC
        if n > limit:
            add("3.1" if proc else "3.2",
                f"{n} words; limit is {limit} for "
                f"{'instructions' if proc else 'descriptive text'}", "error")

        # two instructions in one sentence
        if proc and re.search(r",?\s+and\s+(?:then\s+)?[a-z]+\s", s):
            if len(re.findall(r"\b(?:press|click|select|enter|type|open|close|save|"
                              r"delete|remove|add|set|choose|check|start|stop|turn|"
                              r"send|make|put|use|go|find|verify|ensure|confirm|"
                              r"install|restart|reboot|connect|upload|download|"
                              r"sign|log|wait|review|update|apply|cancel)\b",
                              s, re.I)) > 1:
                add("3.3", "two instructions in one sentence; split it")

        # -ing
        for m in re.finditer(r"\b([A-Za-z]+ing)\b", s):
            g = m.group(1)
            if g.lower() in ING_OK:
                continue
            if ING_STATUS.match(text.strip()):
                continue          # transient status label — permitted
            add("2.3", f"'-ing' form '{g}': use only as a technical noun")

        # passive
        for m in PASSIVE.finditer(s):
            if m.group(1).lower() in PASSIVE_OK:
                continue
            add("2.4", f"passive voice '{m.group(0)}': use the active voice")

        # auxiliary stacks
        if re.search(rf"\b(?:will|would|shall|should|might|must)\s+(?:have|be)\s+\w+(?:ed|en|ing)\b", s, re.I):
            add("2.2", "complex verb construction; use a simple tense", "error")

        # noun clusters
        for c in noun_clusters(s):
            add("1.6", f"noun cluster of {len(c.split())} words: '{c}'")

        # vague opener
        m = re.match(r"^(It|This|That|These|Those)\b(?!\s+(?:is\s+not\s+possible))", s)
        if m and not re.match(r"^(This|That|These|Those)\s+\w+\s", s):
            add("3.4", f"'{m.group(1)}' opens the sentence; name the noun instead")

    low = " " + stripped.lower() + " "
    # Phrases first, then blank them out — otherwise "prior to" also reports the
    # bare word "prior", and the user sees the same fix twice.
    for pat, rep in PHRASES.items():
        m = re.search(pat, low)
        if m:
            add("1.2", f"{m.group(0).strip()} → {rep}")
            low = low[:m.start()] + " " * (m.end() - m.start()) + low[m.end():]
    for w in set(x.lower() for x in words(low)):
        if w in SUBS:
            add("1.2", f"{w} → {SUBS[w]}")
        if w in AMBIGUOUS_MODALS:
            add("modal", f"'{w}' is ambiguous; {AMBIGUOUS_MODALS[w]}")
    for m in CONTRACTIONS.finditer(text):
        add("1.7", f"contraction '{m.group(0)}'; write it in full")
    if re.search(r"[!]", text):
        add("style", "exclamation mark; state the fact")
    return f


def walk_json(obj, path, out, procedural):
    if isinstance(obj, dict):
        for k, v in obj.items():
            walk_json(v, f"{path}.{k}" if path else k, out, procedural)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            walk_json(v, f"{path}[{i}]", out, procedural)
    elif isinstance(obj, str):
        check_string(obj, path, procedural, out)


class Prose(HTMLParser):
    """Pull human-readable prose out of HTML, one block element at a time.

    Without this, HTML falls through to the source-literal scanner, which grabs
    attribute values and splices tag names into the text — producing noise like
    "noun cluster: 'extract watermark span class'" that hides the real findings.
    <code>/<pre>/<kbd> are skipped: identifiers are not prose and must not be
    linted as English.
    """
    BLOCK = {'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th',
             'caption', 'figcaption', 'summary', 'dd', 'dt', 'blockquote',
             'label', 'button', 'option', 'title', 'figure'}
    SKIP = {'script', 'style', 'code', 'pre', 'kbd', 'samp', 'svg'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks, self.buf, self.skip, self.line = [], [], 0, 1

    def _flush(self):
        txt = re.sub(r'\s+', ' ', ''.join(self.buf)).strip()
        if len(txt) > 3:
            self.blocks.append((self.line, txt))
        self.buf = []

    def handle_starttag(self, t, attrs):
        if t in self.SKIP:
            self.skip += 1
        elif t in self.BLOCK:
            self._flush()
            self.line = self.getpos()[0]

    def handle_endtag(self, t):
        if t in self.SKIP:
            self.skip = max(0, self.skip - 1)
        elif t in self.BLOCK:
            self._flush()

    def handle_data(self, d):
        if not self.skip:
            self.buf.append(d)

    def close(self):
        super().close()
        self._flush()


def check_file(path, procedural):
    out = []
    try:
        raw = open(path, encoding="utf-8", errors="replace").read()
    except OSError as e:
        return [{"loc": path, "rule": "io", "severity": "error",
                 "message": str(e), "text": ""}]
    if path.endswith((".html", ".htm")):
        pr = Prose()
        try:
            pr.feed(raw); pr.close()
        except Exception as e:
            return [{"loc": path, "rule": "parse", "severity": "error",
                     "message": "HTML parse failed: %s" % e, "text": ""}]
        for ln, txt in pr.blocks:
            check_string(txt, "%s:%d" % (path, ln), procedural, out)
        return out
    if path.endswith(".json"):
        try:
            walk_json(json.loads(raw), "", out, procedural)
            return [dict(x, loc=f"{path}:{x['loc']}") for x in out]
        except json.JSONDecodeError:
            pass
    if path.endswith((".md", ".markdown")):
        raw = re.sub(r"```[\s\S]*?```", "", raw)
        raw = re.sub(r"`[^`]*`", "", raw)
        blocks, cur = [], []
        for i, line in enumerate(raw.split("\n"), 1):
            if line.strip():
                cur.append((i, line))
            elif cur:
                blocks.append(cur); cur = []
        if cur:
            blocks.append(cur)
        for b in blocks:
            ln = b[0][0]
            txt = " ".join(l for _, l in b)
            if txt.lstrip().startswith(("|", ">", "#")):
                continue
            check_string(txt, f"{path}:{ln}", procedural, out)
        return out
    for i, line in enumerate(raw.split("\n"), 1):
        for m in re.finditer(r'"([^"\\]{12,}?)"|\'([^\'\\]{12,}?)\'', line):
            s = m.group(1) or m.group(2)
            if " " in s:
                check_string(s, f"{path}:{i}", procedural, out)
    return out


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("files", nargs="*")
    ap.add_argument("--text")
    ap.add_argument("--json", action="store_true", dest="as_json")
    ap.add_argument("--procedural", action="store_true")
    ap.add_argument("--descriptive", action="store_true")
    a = ap.parse_args()
    proc = True if a.procedural else (False if a.descriptive else None)

    findings = []
    if a.text:
        findings = check_string(a.text, "<text>", proc)
    elif a.files:
        for p in a.files:
            findings += check_file(p, proc)
    else:
        ap.print_help(); return 2

    # dedupe
    seen, uniq = set(), []
    for f in findings:
        k = (f["loc"], f["rule"], f["message"])
        if k not in seen:
            seen.add(k); uniq.append(f)

    if a.as_json:
        print(json.dumps(uniq, indent=1))
        return 1 if uniq else 0

    if not uniq:
        print("No mechanical violations found.")
        print("Not a conformance certificate — one word/one meaning, register, and "
              "meaning preservation still need review.")
        return 0

    by_loc = {}
    for f in uniq:
        by_loc.setdefault(f["loc"], []).append(f)
    for loc, fs in by_loc.items():
        print(f"\n\033[1m{loc}\033[0m")
        if fs[0]["text"]:
            print(f"  \033[2m{fs[0]['text']}\033[0m")
        for f in fs:
            tag = "\033[31mERR \033[0m" if f["severity"] == "error" else "\033[33mwarn\033[0m"
            print(f"  {tag} [{f['rule']:>5}] {f['message']}")
    errs = sum(1 for f in uniq if f["severity"] == "error")
    print(f"\n{len(uniq)} findings ({errs} errors) in {len(by_loc)} locations.")
    print("Mechanical checks only — vocabulary consistency and meaning need review.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
