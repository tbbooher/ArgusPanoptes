#!/usr/bin/env python3
"""
Step 4: Generate analytics charts for the report using matplotlib.

Reads JSON data files from output/data/ and produces PDF vector charts
in output/figures/.
"""
import json
import os
from pathlib import Path
from collections import Counter

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.cm as cm
from matplotlib.colors import Normalize
import numpy as np

SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR / "output" / "data"
FIGURES_DIR = SCRIPT_DIR / "output" / "figures"

# Consistent color palette
COLORS = {
    "primary": "#2563eb",
    "secondary": "#7c3aed",
    "accent": "#059669",
    "warm": "#dc2626",
    "found": "#2563eb",
    "notfound": "#d1d5db",
}

VENDOR_COLORS = {
    "apollo": "#e74c3c",
    "sirsi_dynix": "#3498db",
    "aspen_discovery": "#2ecc71",
    "atriuum": "#9b59b6",
    "tlc": "#f39c12",
    "bibliocommons": "#1abc9c",
    "polaris": "#e67e22",
    "koha": "#34495e",
    "spydus": "#95a5a6",
    "unknown": "#bdc3c7",
}


def load_json(name):
    with open(DATA_DIR / name) as f:
        return json.load(f)


def style_ax(ax, title, xlabel=None, ylabel=None):
    """Apply consistent styling to axes."""
    ax.set_title(title, fontsize=12, fontweight="bold", pad=10)
    if xlabel:
        ax.set_xlabel(xlabel, fontsize=10)
    if ylabel:
        ax.set_ylabel(ylabel, fontsize=10)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)


def chart1_top_systems_bar():
    """Horizontal bar chart: top 25 systems by books held."""
    systems = load_json("top_systems.json")[:25]
    systems.reverse()  # Bottom-to-top for horizontal bar

    fig, ax = plt.subplots(figsize=(8, 8))

    names = [s["systemName"] for s in systems]
    books = [s["booksHeld"] for s in systems]

    # Truncate long names
    names = [n[:40] + "..." if len(n) > 40 else n for n in names]

    bars = ax.barh(range(len(names)), books, color=COLORS["primary"], edgecolor="white", height=0.7)
    ax.set_yticks(range(len(names)))
    ax.set_yticklabels(names, fontsize=8)

    # Value labels
    for bar, val in zip(bars, books):
        ax.text(bar.get_width() + 0.5, bar.get_y() + bar.get_height() / 2,
                str(val), va="center", fontsize=7, color="#333333")

    style_ax(ax, "Top 25 Library Systems by Books Held", xlabel="Books held")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "top_systems_bar.pdf", bbox_inches="tight")
    plt.close(fig)
    print("  top_systems_bar.pdf")


def chart2_top_books_bar():
    """Horizontal bar chart: top 25 most widely held books."""
    books = load_json("top_books.json")[:25]
    books.reverse()

    fig, ax = plt.subplots(figsize=(8, 8))

    titles = [b["title"][:45] + "..." if len(b["title"]) > 45 else b["title"] for b in books]
    counts = [b["systemCount"] for b in books]

    bars = ax.barh(range(len(titles)), counts, color=COLORS["secondary"], edgecolor="white", height=0.7)
    ax.set_yticks(range(len(titles)))
    ax.set_yticklabels(titles, fontsize=7)

    for bar, val in zip(bars, counts):
        ax.text(bar.get_width() + 0.3, bar.get_y() + bar.get_height() / 2,
                str(val), va="center", fontsize=7, color="#333333")

    style_ax(ax, "Top 25 Most Widely Held Books", xlabel="Number of library systems")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "top_books_bar.pdf", bbox_inches="tight")
    plt.close(fig)
    print("  top_books_bar.pdf")


def chart3_books_per_system_hist():
    """Histogram: how many systems hold N books."""
    systems = load_json("top_systems.json")

    fig, ax = plt.subplots(figsize=(7, 5))

    books_counts = [s["booksHeld"] for s in systems]
    bins = np.arange(0, max(books_counts) + 10, 10)

    ax.hist(books_counts, bins=bins, color=COLORS["primary"], edgecolor="white", alpha=0.85)

    style_ax(ax, "Distribution of Books Held per System",
             xlabel="Books held", ylabel="Number of systems")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "books_per_system_hist.pdf", bbox_inches="tight")
    plt.close(fig)
    print("  books_per_system_hist.pdf")


def chart4_systems_per_book_hist():
    """Histogram: how many books are in N systems."""
    books = load_json("top_books.json")

    fig, ax = plt.subplots(figsize=(7, 5))

    system_counts = [b["systemCount"] for b in books]
    max_count = max(system_counts) if system_counts else 1
    bins = np.arange(0, max_count + 5, 5)

    ax.hist(system_counts, bins=bins, color=COLORS["secondary"], edgecolor="white", alpha=0.85)

    style_ax(ax, "Distribution of Systems per Book",
             xlabel="Number of systems holding the book", ylabel="Number of books")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "systems_per_book_hist.pdf", bbox_inches="tight")
    plt.close(fig)
    print("  systems_per_book_hist.pdf")


def chart5_vendor_breakdown():
    """Donut chart of systems by ILS vendor."""
    metadata = load_json("system_metadata.json")
    enabled = [s for s in metadata if s["enabled"]]

    vendor_counts = Counter(s["vendor"] for s in enabled)
    # Sort by count descending
    sorted_vendors = sorted(vendor_counts.items(), key=lambda x: -x[1])

    labels = []
    sizes = []
    colors = []
    for vendor, count in sorted_vendors:
        pretty = vendor.replace("_", " ").title()
        labels.append(f"{pretty} ({count})")
        sizes.append(count)
        colors.append(VENDOR_COLORS.get(vendor, "#bdc3c7"))

    fig, ax = plt.subplots(figsize=(7, 7))
    wedges, texts, autotexts = ax.pie(
        sizes, labels=labels, colors=colors, autopct="%1.0f%%",
        startangle=90, pctdistance=0.80,
        wedgeprops=dict(width=0.4, edgecolor="white", linewidth=1.5),
        textprops=dict(fontsize=8),
    )
    for autotext in autotexts:
        autotext.set_fontsize(7)

    ax.set_title("Library Systems by ILS Vendor", fontsize=12, fontweight="bold", pad=15)

    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "vendor_breakdown.pdf", bbox_inches="tight")
    plt.close(fig)
    print("  vendor_breakdown.pdf")


def chart6_availability_bar():
    """Bar chart of availability rates for top systems."""
    systems = load_json("top_systems.json")

    # Filter to systems with copies and sort by availability rate
    with_copies = [s for s in systems if s["totalCopies"] > 0]
    for s in with_copies:
        s["availRate"] = s["totalAvailable"] / s["totalCopies"]

    # Show top 25 by books held (same as chart 1 for consistency)
    top = sorted(with_copies, key=lambda s: -s["booksHeld"])[:25]
    top.sort(key=lambda s: s["availRate"])

    fig, ax = plt.subplots(figsize=(8, 8))

    names = [s["systemName"][:40] for s in top]
    rates = [s["availRate"] for s in top]

    colors_list = [cm.RdYlGn(r) for r in rates]
    bars = ax.barh(range(len(names)), rates, color=colors_list, edgecolor="white", height=0.7)
    ax.set_yticks(range(len(names)))
    ax.set_yticklabels(names, fontsize=8)
    ax.set_xlim(0, 1.05)

    for bar, val in zip(bars, rates):
        ax.text(bar.get_width() + 0.01, bar.get_y() + bar.get_height() / 2,
                f"{val:.0%}", va="center", fontsize=7, color="#333333")

    style_ax(ax, "Book Availability Rate — Top 25 Systems", xlabel="Availability rate")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "availability_bar.pdf", bbox_inches="tight")
    plt.close(fig)
    print("  availability_bar.pdf")


def chart7_found_vs_notfound():
    """Donut chart: found vs not-found books."""
    stats = load_json("summary_stats.json")

    fig, ax = plt.subplots(figsize=(5, 5))

    sizes = [stats["booksFound"], stats["booksNotFound"]]
    labels = [f"Found ({stats['booksFound']})", f"Not found ({stats['booksNotFound']})"]
    colors = [COLORS["found"], COLORS["notfound"]]

    wedges, texts, autotexts = ax.pie(
        sizes, labels=labels, colors=colors, autopct="%1.1f%%",
        startangle=90, pctdistance=0.75,
        wedgeprops=dict(width=0.35, edgecolor="white", linewidth=2),
        textprops=dict(fontsize=10),
    )
    for autotext in autotexts:
        autotext.set_fontsize(9)
        autotext.set_fontweight("bold")

    ax.set_title("Books Found in Texas Libraries", fontsize=12, fontweight="bold", pad=15)

    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "found_vs_notfound.pdf", bbox_inches="tight")
    plt.close(fig)
    print("  found_vs_notfound.pdf")


def chart8_copies_scatter():
    """Scatter plot: books held vs total copies per system."""
    systems = load_json("top_systems.json")

    fig, ax = plt.subplots(figsize=(7, 6))

    books = [s["booksHeld"] for s in systems]
    copies = [s["totalCopies"] for s in systems]

    ax.scatter(books, copies, s=30, c=COLORS["primary"], alpha=0.6, edgecolors="white", linewidth=0.4)

    # Label outliers (top 5 by copies)
    top_by_copies = sorted(systems, key=lambda s: -s["totalCopies"])[:5]
    for s in top_by_copies:
        label = s["systemName"].replace(" Public Library", "").replace(" Library System", "")[:25]
        ax.annotate(
            label, (s["booksHeld"], s["totalCopies"]),
            xytext=(5, 5), textcoords="offset points",
            fontsize=6, alpha=0.8,
        )

    style_ax(ax, "Books Held vs. Total Copies per System",
             xlabel="Unique books held", ylabel="Total copies")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "copies_scatter.pdf", bbox_inches="tight")
    plt.close(fig)
    print("  copies_scatter.pdf")


def main():
    os.makedirs(FIGURES_DIR, exist_ok=True)

    chart1_top_systems_bar()
    chart2_top_books_bar()
    chart3_books_per_system_hist()
    chart4_systems_per_book_hist()
    chart5_vendor_breakdown()
    chart6_availability_bar()
    chart7_found_vs_notfound()
    chart8_copies_scatter()


if __name__ == "__main__":
    main()
