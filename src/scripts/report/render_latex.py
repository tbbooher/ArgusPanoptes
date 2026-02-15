#!/usr/bin/env python3
"""
Step 5: Render Jinja2 templates into .tex files using extracted JSON data.

Loads all JSON data files, applies Jinja2 templates, writes rendered .tex
files to output/tex/ for XeLaTeX compilation.
"""
import json
import os
import re
import shutil
from datetime import date
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR / "output" / "data"
TEMPLATE_DIR = SCRIPT_DIR / "template"
TEX_DIR = SCRIPT_DIR / "output" / "tex"

# Characters that need escaping in LaTeX
LATEX_SPECIAL = re.compile(r"([&%$#_{}~^\\])")
LATEX_ESCAPE_MAP = {
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
    "\\": r"\textbackslash{}",
}

# ── Thematic categorization ──────────────────────────────────────────────────

THEME_KEYWORDS = {
    "Gender Identity & Transgender": [
        "transgender", "trans ", "trans-", "gender identity", "nonbinary",
        "non-binary", "genderqueer", "gender queer", "gender creative",
        "cisgender", "assigned male", "assigned female", "gender spectrum",
        "gender fluid", "they/them",
    ],
    "LGBTQ+ Content": [
        "gay", "lesbian", "queer", "bisexual", "lgbtq", "same-sex",
        "two moms", "two dads", "two brides", "pride parade", "homosexual",
        "coming out", "drag queen",
    ],
    "Sexuality & Sex Education": [
        "sex education", "sex is a", "sexuality", "sexual identity",
        "sexual orientation", "bodies, feelings", "puberty",
        "s.e.x.", "sex, puberty",
    ],
    "Abortion & Reproductive Politics": [
        "abortion", "roe v. wade", "reproductive right", "pro-choice",
        "pro-life", "planned parenthood",
    ],
    "Critical Race Theory & Racial Activism": [
        "black lives matter", "blm", "critical race", "antiracist",
        "anti-racist", "white fragility", "white privilege",
        "systemic racism", "white supremacy",
    ],
}


def categorize_book(book):
    """Return set of theme categories a book belongs to."""
    text = book.get("title", "").lower()
    cats = set()
    for cat, kws in THEME_KEYWORDS.items():
        if any(kw in text for kw in kws):
            cats.add(cat)
    return cats


def build_theme_stats(all_books):
    """Build thematic breakdown with counts and example titles."""
    theme_data = {}
    for cat in THEME_KEYWORDS:
        matching = []
        for b in all_books:
            if cat in categorize_book(b):
                matching.append(b)
        matching.sort(key=lambda b: b.get("systemCount", 0), reverse=True)
        theme_data[cat] = {
            "count": len(matching),
            "examples": [b["title"] for b in matching[:5]],
            "top_system_counts": [b.get("systemCount", 0) for b in matching[:5]],
            "total_holdings": sum(b.get("systemCount", 0) for b in matching),
        }
    return theme_data


# ── Jinja2 filters ───────────────────────────────────────────────────────────


def latex_escape(text):
    """Escape LaTeX special characters in text."""
    if not text:
        return ""
    text = str(text)
    return LATEX_SPECIAL.sub(lambda m: LATEX_ESCAPE_MAP[m.group(1)], text)


def truncate_text(text, max_len):
    """Truncate text and add ellipsis if too long."""
    if not text:
        return ""
    text = str(text)
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def join_authors(authors):
    """Join author list into a comma-separated string."""
    if not authors:
        return ""
    if isinstance(authors, str):
        return authors
    if len(authors) == 1:
        return authors[0]
    if len(authors) == 2:
        return f"{authors[0]} and {authors[1]}"
    return f"{authors[0]} et al."


def vendor_pretty(vendor):
    """Convert vendor ID to pretty display name."""
    names = {
        "sirsi_dynix": "SirsiDynix",
        "innovative_sierra": "Sierra",
        "polaris": "Polaris",
        "evergreen": "Evergreen",
        "koha": "Koha",
        "bibliocommons": "BiblioCommons",
        "carl_x": "CARL.X",
        "apollo": "Apollo/Biblionix",
        "atriuum": "Atriuum",
        "tlc": "TLC",
        "aspen_discovery": "Aspen Discovery",
        "spydus": "Spydus",
        "iii_vega": "III Vega",
        "unknown": "Unknown",
    }
    return names.get(vendor, vendor)


def format_number(value):
    """Format integer with comma separators."""
    try:
        return f"{int(value):,}"
    except (ValueError, TypeError):
        return str(value)


def load_json(name):
    with open(DATA_DIR / name) as f:
        return json.load(f)


def build_context():
    """Load all JSON data and build the Jinja2 template context."""
    stats = load_json("summary_stats.json")
    top_books = load_json("top_books.json")
    top_systems = load_json("top_systems.json")
    system_holdings = load_json("system_holdings.json")
    not_found = load_json("not_found_books.json")
    metadata = load_json("system_metadata.json")

    # Build metadata lookup
    meta_map = {m["id"]: m for m in metadata}

    # Enrich top_systems with metadata + books
    for sys in top_systems:
        sid = sys["systemId"]
        meta = meta_map.get(sid, {})
        sys["city"] = meta.get("city", None)
        sys["region"] = meta.get("region", "")
        sys["vendor"] = meta.get("vendor", "unknown")

        # Attach book list from system_holdings
        sh = system_holdings.get(sid, {})
        sys["books"] = sh.get("books", [])
        sys["topTitles"] = "; ".join(
            b["title"][:30] for b in sys["books"][:3]
        )

    # Tier split
    tier1 = [s for s in top_systems if s["booksHeld"] >= 20]
    tier2 = [s for s in top_systems if 5 <= s["booksHeld"] < 20]
    tier3 = [s for s in top_systems if 1 <= s["booksHeld"] < 5]

    found_pct = (
        round(100 * stats["booksFound"] / stats["booksScanned"], 1)
        if stats["booksScanned"] > 0
        else 0
    )

    # Thematic analysis
    all_books_with_counts = top_books + [
        {**b, "systemCount": 0} for b in not_found
    ]
    themes = build_theme_stats(all_books_with_counts)

    # Compute total copies across all systems
    total_copies = sum(s["totalCopies"] for s in top_systems)

    # Metro breakdown
    dfw_systems = [
        s for s in top_systems
        if s.get("region", "") in [
            "Dallas County", "Tarrant County", "Collin County",
            "Denton County", "Ellis County", "Johnson County",
            "Rockwall County", "Kaufman County", "Wise County",
        ]
    ]
    houston_systems = [
        s for s in top_systems
        if s.get("region", "") in [
            "Harris County", "Fort Bend County", "Montgomery County",
            "Galveston County", "Brazoria County",
        ]
    ]
    austin_systems = [
        s for s in top_systems
        if s.get("region", "") in [
            "Travis County", "Williamson County", "Hays County",
        ]
    ]
    sa_systems = [
        s for s in top_systems
        if s.get("region", "") in [
            "Bexar County",
        ]
    ]

    return {
        "report_date": date.today().strftime("%B %d, %Y"),
        "stats": stats,
        "found_pct": found_pct,
        "top_book": top_books[0] if top_books else {},
        "top_system": top_systems[0] if top_systems else {},
        "top_books": top_books,
        "top_systems": top_systems,
        "tier1": tier1,
        "tier2": tier2,
        "tier3": tier3,
        "not_found": not_found,
        "themes": themes,
        "total_copies": total_copies,
        "dfw_systems": dfw_systems,
        "houston_systems": houston_systems,
        "austin_systems": austin_systems,
        "sa_systems": sa_systems,
        "dfw_books": sum(s["booksHeld"] for s in dfw_systems),
        "houston_books": sum(s["booksHeld"] for s in houston_systems),
        "austin_books": sum(s["booksHeld"] for s in austin_systems),
        "sa_books": sum(s["booksHeld"] for s in sa_systems),
        "top5_copies": sum(s["totalCopies"] for s in top_systems[:5]),
    }


def main():
    os.makedirs(TEX_DIR, exist_ok=True)

    # Copy static preamble
    shutil.copy2(TEMPLATE_DIR / "preamble.tex", TEX_DIR / "preamble.tex")

    # Set up Jinja2 environment
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        block_start_string="{% ",
        block_end_string=" %}",
        variable_start_string="{{ ",
        variable_end_string=" }}",
        comment_start_string="{# ",
        comment_end_string=" #}",
        autoescape=False,
    )

    # Register custom filters
    env.filters["latex_escape"] = latex_escape
    env.filters["truncate_text"] = truncate_text
    env.filters["join_authors"] = join_authors
    env.filters["vendor_pretty"] = vendor_pretty
    env.filters["format_number"] = format_number

    context = build_context()

    # Render each template
    templates = [
        "report.tex.j2",
        "executive_summary.tex.j2",
        "analytics.tex.j2",
        "library_profiles.tex.j2",
        "appendix.tex.j2",
    ]

    for template_name in templates:
        template = env.get_template(template_name)
        rendered = template.render(**context)

        # Output name: strip .j2 suffix
        output_name = template_name.replace(".j2", "")
        output_path = TEX_DIR / output_name
        output_path.write_text(rendered)
        print(f"  {output_name}")


if __name__ == "__main__":
    main()
