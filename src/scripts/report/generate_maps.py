#!/usr/bin/env python3
"""
Step 3: Generate Texas library maps using matplotlib + Shapely.

Reads geocoded_libraries.json and tx_counties.geojson, produces PDF vector
figures for the report.
"""
import json
import os
import math
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.collections import PatchCollection
from matplotlib.colors import Normalize
import matplotlib.cm as cm
import numpy as np
from shapely.geometry import shape

SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR / "output" / "data"
FIGURES_DIR = SCRIPT_DIR / "output" / "figures"
GEOJSON_PATH = SCRIPT_DIR / "tx_counties.geojson"

# DFW bounding box (approximate)
DFW_BOUNDS = {"lon": (-97.8, -96.3), "lat": (32.3, 33.4)}
# Houston bounding box
HOUSTON_BOUNDS = {"lon": (-96.0, -94.8), "lat": (29.2, 30.2)}


def load_data():
    """Load geocoded libraries and county GeoJSON."""
    with open(DATA_DIR / "geocoded_libraries.json") as f:
        libraries = json.load(f)
    with open(GEOJSON_PATH) as f:
        counties = json.load(f)
    return libraries, counties


def county_patches(counties_geojson):
    """Convert GeoJSON features to matplotlib patches."""
    patches = []
    for feature in counties_geojson["features"]:
        geom = shape(feature["geometry"])
        if geom.geom_type == "Polygon":
            x, y = geom.exterior.xy
            patches.append(plt.Polygon(list(zip(x, y)), closed=True))
        elif geom.geom_type == "MultiPolygon":
            for poly in geom.geoms:
                x, y = poly.exterior.xy
                patches.append(plt.Polygon(list(zip(x, y)), closed=True))
    return patches


def draw_county_base(ax, counties_geojson):
    """Draw county boundaries as thin gray lines."""
    patches = county_patches(counties_geojson)
    pc = PatchCollection(
        patches,
        facecolor="#f7f7f7",
        edgecolor="#cccccc",
        linewidth=0.3,
    )
    ax.add_collection(pc)
    ax.set_xlim(-107.0, -93.4)
    ax.set_ylim(25.7, 36.6)
    ax.set_aspect("equal")
    ax.axis("off")


def fig1_overview_map(libraries, counties):
    """All 260 enabled libraries. Dot size = sqrt(books_held), color by books_held."""
    fig, ax = plt.subplots(1, 1, figsize=(8, 8))
    draw_county_base(ax, counties)

    enabled = [lib for lib in libraries if lib["enabled"] and lib["lat"] is not None]
    has_holdings = [lib for lib in enabled if lib["booksHeld"] > 0]
    no_holdings = [lib for lib in enabled if lib["booksHeld"] == 0]

    # Systems with no holdings: small hollow circles
    if no_holdings:
        lngs = [lib["lng"] for lib in no_holdings]
        lats = [lib["lat"] for lib in no_holdings]
        ax.scatter(lngs, lats, s=8, facecolors="none", edgecolors="#999999",
                   linewidth=0.5, zorder=3, alpha=0.6)

    # Systems with holdings: sized and colored
    if has_holdings:
        lngs = [lib["lng"] for lib in has_holdings]
        lats = [lib["lat"] for lib in has_holdings]
        books = [lib["booksHeld"] for lib in has_holdings]
        sizes = [max(8, math.sqrt(b) * 4) for b in books]

        norm = Normalize(vmin=1, vmax=max(books))
        cmap = cm.YlOrRd
        colors = [cmap(norm(b)) for b in books]

        scatter = ax.scatter(lngs, lats, s=sizes, c=colors, edgecolors="black",
                             linewidth=0.3, zorder=4, alpha=0.85)

        # Colorbar
        sm = cm.ScalarMappable(cmap=cmap, norm=norm)
        sm.set_array([])
        cbar = fig.colorbar(sm, ax=ax, shrink=0.4, pad=0.02)
        cbar.set_label("Books held", fontsize=9)

    ax.set_title("Texas Library Systems — Book Holdings", fontsize=13, fontweight="bold", pad=10)

    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "texas_overview_map.pdf", bbox_inches="tight", dpi=150)
    plt.close(fig)
    print("  texas_overview_map.pdf")


def fig2_coverage_choropleth(libraries, counties):
    """Counties shaded by total books held across systems in that county."""
    # Build county → total books mapping from library regions
    county_books = {}
    for lib in libraries:
        if lib["enabled"] and lib["booksHeld"] > 0:
            county = lib["region"]
            county_books[county] = county_books.get(county, 0) + lib["booksHeld"]

    fig, ax = plt.subplots(1, 1, figsize=(8, 8))

    max_books = max(county_books.values()) if county_books else 1
    norm = Normalize(vmin=0, vmax=max_books)
    cmap = cm.Blues

    for feature in counties["features"]:
        geom = shape(feature["geometry"])
        # Try to match county name from GeoJSON properties
        county_name = None
        for key in ["NAME", "NAMELSAD", "name"]:
            if key in feature.get("properties", {}):
                county_name = feature["properties"][key]
                break

        # Normalize: GeoJSON has "Travis" but our data has "Travis County"
        books = 0
        if county_name:
            books = county_books.get(f"{county_name} County", 0)
            if books == 0:
                books = county_books.get(county_name, 0)

        color = cmap(norm(books)) if books > 0 else "#f0f0f0"

        polygons = []
        if geom.geom_type == "Polygon":
            polygons = [geom]
        elif geom.geom_type == "MultiPolygon":
            polygons = list(geom.geoms)

        for poly in polygons:
            x, y = poly.exterior.xy
            patch = plt.Polygon(list(zip(x, y)), closed=True,
                                facecolor=color, edgecolor="#aaaaaa", linewidth=0.3)
            ax.add_patch(patch)

    ax.set_xlim(-107.0, -93.4)
    ax.set_ylim(25.7, 36.6)
    ax.set_aspect("equal")
    ax.axis("off")

    sm = cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    cbar = fig.colorbar(sm, ax=ax, shrink=0.4, pad=0.02)
    cbar.set_label("Total books held (by county)", fontsize=9)

    ax.set_title("County-Level Coverage", fontsize=13, fontweight="bold", pad=10)

    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "texas_coverage_choropleth.pdf", bbox_inches="tight", dpi=150)
    plt.close(fig)
    print("  texas_coverage_choropleth.pdf")


def fig_inset_map(libraries, counties, bounds, title, filename, label_threshold=30):
    """Zoomed inset map for a metro area."""
    fig, ax = plt.subplots(1, 1, figsize=(8, 7))

    # Draw county boundaries clipped to bounds
    for feature in counties["features"]:
        geom = shape(feature["geometry"])
        polygons = []
        if geom.geom_type == "Polygon":
            polygons = [geom]
        elif geom.geom_type == "MultiPolygon":
            polygons = list(geom.geoms)

        for poly in polygons:
            x, y = poly.exterior.xy
            patch = plt.Polygon(list(zip(x, y)), closed=True,
                                facecolor="#f5f5f5", edgecolor="#cccccc", linewidth=0.4)
            ax.add_patch(patch)

    ax.set_xlim(*bounds["lon"])
    ax.set_ylim(*bounds["lat"])
    ax.set_aspect("equal")
    ax.axis("off")

    # Plot libraries in bounds
    in_bounds = [
        lib for lib in libraries
        if lib["enabled"] and lib["lat"] is not None
        and bounds["lat"][0] <= lib["lat"] <= bounds["lat"][1]
        and bounds["lon"][0] <= lib["lng"] <= bounds["lon"][1]
    ]

    if in_bounds:
        has_holdings = [lib for lib in in_bounds if lib["booksHeld"] > 0]
        no_holdings = [lib for lib in in_bounds if lib["booksHeld"] == 0]

        if no_holdings:
            ax.scatter(
                [lib["lng"] for lib in no_holdings],
                [lib["lat"] for lib in no_holdings],
                s=20, facecolors="none", edgecolors="#999999",
                linewidth=0.6, zorder=3
            )

        if has_holdings:
            max_b = max(lib["booksHeld"] for lib in has_holdings)
            norm = Normalize(vmin=1, vmax=max(max_b, 1))
            cmap = cm.YlOrRd

            for lib in has_holdings:
                size = max(20, math.sqrt(lib["booksHeld"]) * 5)
                color = cmap(norm(lib["booksHeld"]))
                ax.scatter(lib["lng"], lib["lat"], s=size, c=[color],
                           edgecolors="black", linewidth=0.4, zorder=4, alpha=0.85)

                # Label systems with enough books
                if lib["booksHeld"] >= label_threshold:
                    ax.annotate(
                        lib["name"].replace(" Public Library", "").replace(" Library System", ""),
                        (lib["lng"], lib["lat"]),
                        xytext=(5, 5), textcoords="offset points",
                        fontsize=6, fontweight="bold",
                        bbox=dict(boxstyle="round,pad=0.15", facecolor="white",
                                  edgecolor="none", alpha=0.8),
                        zorder=5,
                    )

    ax.set_title(title, fontsize=13, fontweight="bold", pad=10)

    fig.tight_layout()
    fig.savefig(FIGURES_DIR / filename, bbox_inches="tight", dpi=150)
    plt.close(fig)
    print(f"  {filename}")


def fig5_availability_map(libraries, counties):
    """Dots colored by availability rate (available / total copies)."""
    fig, ax = plt.subplots(1, 1, figsize=(8, 8))
    draw_county_base(ax, counties)

    with_copies = [
        lib for lib in libraries
        if lib["enabled"] and lib["lat"] is not None and lib["totalCopies"] > 0
    ]

    if with_copies:
        lngs = [lib["lng"] for lib in with_copies]
        lats = [lib["lat"] for lib in with_copies]
        rates = [lib["totalAvailable"] / lib["totalCopies"] for lib in with_copies]
        sizes = [max(10, math.sqrt(lib["booksHeld"]) * 4) for lib in with_copies]

        norm = Normalize(vmin=0, vmax=1)
        cmap = cm.RdYlGn

        scatter = ax.scatter(lngs, lats, s=sizes, c=rates, cmap=cmap, norm=norm,
                             edgecolors="black", linewidth=0.3, zorder=4, alpha=0.85)

        sm = cm.ScalarMappable(cmap=cmap, norm=norm)
        sm.set_array([])
        cbar = fig.colorbar(sm, ax=ax, shrink=0.4, pad=0.02)
        cbar.set_label("Availability rate", fontsize=9)

    ax.set_title("Book Availability by System", fontsize=13, fontweight="bold", pad=10)

    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "texas_availability_map.pdf", bbox_inches="tight", dpi=150)
    plt.close(fig)
    print("  texas_availability_map.pdf")


def main():
    os.makedirs(FIGURES_DIR, exist_ok=True)
    libraries, counties = load_data()

    fig1_overview_map(libraries, counties)
    fig2_coverage_choropleth(libraries, counties)
    fig_inset_map(libraries, counties, DFW_BOUNDS,
                  "Dallas\u2013Fort Worth Metroplex", "dfw_inset_map.pdf", label_threshold=15)
    fig_inset_map(libraries, counties, HOUSTON_BOUNDS,
                  "Houston Metro Area", "houston_inset_map.pdf", label_threshold=15)
    fig5_availability_map(libraries, counties)


if __name__ == "__main__":
    main()
