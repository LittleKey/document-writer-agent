#!/usr/bin/env python3
"""Reconstruct a coarse world land/water grid using handwritten geography.

Requires Python 3.9+ and only the standard library. No network requests,
geographic databases, reference maps, or third-party land classifiers are used.
Every geographic coordinate below was written as a knowledge-based approximation,
not copied from a map or dataset. These are NOT accurate coastline measurements.

Method: union of approximate mainland/island polygons, minus explicit sea
polygons. Point-in-polygon arithmetic classifies the complete sampling grid;
this is NOT independent language-model reasoning for each of the 16,200 points.

Coordinates are decimal-degree (longitude, latitude) pairs on WGS84 axes.
The polygons are straight-line approximations in this longitude/latitude plane.
Longitudes beyond 180 are intentional: classification handles date-line wrapping.

Inland lakes are retained as land, including the Caspian Sea and Great Lakes.
Land ice is land. Sea ice does not create land. Antarctica's Ross and Weddell
embayments follow rough remembered grounding-line positions to leave the major
floating ice shelves as water. Their exact boundaries are uncertain, like the
other coasts here; no physical coastline/grounding-line dataset is consulted.
Small islands can disappear because none of the 2-degree samples hits them.

Run:
    python3 reconstruct_world.py
    python3 reconstruct_world.py --output-dir /path/to/output
"""

import argparse
import csv
import json
from pathlib import Path
import struct
from typing import Dict, List, NamedTuple, Tuple
import zlib


Point = Tuple[float, float]
Polygon = Tuple[Point, ...]

LATITUDES = tuple(range(89, -90, -2))
LONGITUDES = tuple(range(-179, 180, 2))
SCALE = 8

# Handwritten mainland coast approximations. All positions are guesses from
# prior geographic knowledge. Order follows each polygon's perimeter.
LAND_POLYGONS: Dict[str, Polygon] = {
    "North American mainland, including Central America": (
        (-168, 66), (-166, 69), (-159, 71), (-151, 71), (-143, 70),
        (-137, 69), (-130, 70), (-124, 70), (-120, 69), (-116, 68),
        (-111, 69), (-107, 68), (-105, 66), (-100, 67), (-96, 69),
        (-93, 71), (-90, 71), (-92, 68), (-87, 68), (-85, 65),
        # Hudson Bay and James Bay are sea, not filled-in inland lakes.
        (-89, 64), (-93, 63), (-95, 60), (-93, 57), (-89, 56),
        (-84, 55), (-82, 53), (-80, 51), (-79, 54), (-78, 58),
        (-77, 61), (-75, 62), (-72, 61), (-70, 59), (-67, 60),
        (-65, 60), (-62, 57), (-60, 54), (-57, 51), (-60, 50),
        (-65, 50), (-69, 48), (-68, 47), (-65, 48), (-64, 46),
        (-61, 46), (-60, 45), (-64, 44), (-67, 45), (-70, 43),
        (-72, 41), (-74, 40), (-75, 38), (-76, 36), (-78, 34),
        (-80, 32), (-81, 29), (-80, 27), (-81, 25), (-82, 25),
        (-82, 28), (-84, 30), (-88, 30), (-90, 29), (-94, 29),
        (-97, 26), (-97, 23), (-96, 20), (-93, 18), (-91, 19),
        (-90, 21), (-87, 22), (-86, 21), (-87, 18), (-88, 16),
        (-85, 16), (-83, 15), (-83, 12), (-82, 10), (-80, 9),
        (-78, 9), (-77, 8), (-79, 7), (-81, 8), (-83, 9),
        (-85, 10), (-86, 12), (-88, 13), (-90, 14), (-93, 16),
        (-98, 17), (-102, 18), (-106, 22), (-109, 25), (-112, 29),
        # Gulf of California indentation and Baja California peninsula.
        (-114.5, 32), (-112, 28), (-110, 24), (-110, 23),
        (-111.5, 23), (-114, 27), (-116, 29), (-117, 32),
        (-120, 34), (-122, 37), (-124, 41), (-124, 46), (-123, 49),
        (-126, 50), (-128, 53), (-130, 55), (-134, 57), (-137, 59),
        (-141, 60), (-146, 60), (-150, 59), (-153, 57), (-157, 56),
        (-162, 55), (-164, 55), (-162, 57), (-158, 58), (-160, 60),
        (-164, 60), (-165, 63), (-168, 64),
    ),
    "South American mainland": (
        (-79, 7), (-77, 9), (-75, 11), (-72, 12), (-70, 12),
        (-68, 11), (-64, 10), (-61, 10), (-60, 8), (-57, 6),
        (-52, 4), (-50, 1), (-48, -1), (-44, -2), (-41, -3),
        (-38, -5), (-35, -6), (-35, -9), (-37, -13), (-39, -16),
        (-40, -20), (-43, -23), (-47, -25), (-49, -28), (-52, -32),
        (-54, -34), (-57, -36), (-56, -38), (-61, -39), (-62, -42),
        (-65, -44), (-66, -48), (-68, -51), (-70, -52), (-72, -54),
        (-74, -52), (-75, -48), (-74, -44), (-74, -40), (-73, -37),
        (-72, -33), (-71, -30), (-70, -26), (-70, -21), (-72, -18),
        (-75, -15), (-78, -10), (-81, -6), (-81, -3), (-80, 0),
        (-79, 2), (-77, 4), (-78, 6),
    ),
    "African mainland, including Sinai": (
        (-17, 21), (-17, 15), (-17, 12), (-15, 10), (-13, 8),
        (-10, 6), (-7, 5), (-2, 5), (1, 6), (5, 5), (8, 4),
        (9, 2), (10, 0), (9, -2), (12, -6), (13, -10),
        (12, -16), (14, -20), (15, -24), (17, -29), (18, -33),
        (20, -35), (24, -34), (28, -32), (31, -29), (33, -26),
        (35, -23), (36, -18), (39, -15), (40, -11), (40, -6),
        (42, 0), (46, 4), (51, 11), (49, 12), (44, 11),
        (43, 13), (41, 15), (38, 18), (36, 22), (34, 27),
        (33, 29), (34, 31), (32, 31), (29, 31), (25, 32),
        (21, 33), (18, 31), (15, 32), (13, 33), (11, 34),
        (10, 37), (6, 37), (3, 37), (0, 36), (-3, 35),
        (-6, 36), (-9, 32), (-11, 28), (-13, 27),
    ),
    "Eurasian mainland, including Arabia, India, and Malay peninsula": (
        (-9, 36), (-6, 36), (-4, 37), (-1, 38), (0, 41), (3, 43),
        (5, 44), (7, 44), (9, 44), (10, 42), (12, 42), (13, 40),
        (16, 38), (16, 40), (14, 42), (13, 44), (14, 45),
        (16, 44), (18, 42), (20, 40), (21, 37), (23, 37),
        (23, 39), (24, 40), (26, 41), (26, 39), (28, 37),
        (30, 36), (33, 36), (36, 36), (36, 34), (35, 32),
        (34, 31), (33, 30), (32, 30), (33, 28), (35, 28),
        (36, 26), (38, 23), (39, 21), (42, 17), (44, 13),
        (46, 13), (49, 14), (52, 16), (55, 17), (57, 21),
        (59, 23), (57, 25), (55, 26), (52, 24), (50, 26),
        # Persian Gulf indentation.
        (48, 29), (49, 30), (51, 30), (53, 27), (57, 26),
        (60, 25), (63, 25), (67, 24), (69, 22), (71, 21),
        (73, 17), (74, 14), (76, 10), (77, 8), (79, 8),
        (80, 12), (80, 15), (83, 17), (86, 20), (89, 22),
        (91, 22), (93, 20), (94, 17), (96, 16), (98, 10),
        (99, 7), (101, 3), (104, 1), (104, 3), (102, 6),
        (100, 9), (100, 13), (102, 13), (104, 10), (106, 9),
        (108, 12), (109, 16), (107, 18), (106, 20), (108, 21),
        (111, 21), (114, 22), (118, 24), (120, 27), (122, 30),
        (121, 33), (119, 35), (122, 37), (122, 40), (124, 40),
        (125, 38), (126, 35), (129, 35), (130, 38), (130, 42),
        (132, 43), (135, 45), (138, 49), (141, 52), (140, 55),
        (136, 55), (138, 58), (141, 59), (146, 59), (151, 59),
        (155, 59), (156, 56), (156, 52), (158, 51), (161, 55),
        (163, 57), (164, 60), (168, 61), (174, 60), (178, 62),
        # Chukotka crosses 180 degrees; vertices remain continuous here.
        (179, 65), (183, 65), (190, 66), (190, 68), (183, 70),
        (178, 70), (173, 69), (168, 70), (163, 70), (159, 70),
        (156, 72), (150, 72), (145, 73), (140, 73), (133, 71),
        (128, 73), (122, 73), (118, 75), (111, 77), (104, 78),
        (99, 77), (96, 74), (89, 74), (87, 72), (81, 72),
        (76, 71), (73, 73), (70, 73), (68, 70), (66, 69),
        (60, 70), (57, 69), (52, 68), (47, 68), (44, 67),
        # White Sea indentation and Kola peninsula.
        (43, 66), (40, 66), (36, 64), (34, 65), (35, 67),
        (40, 68), (41, 69), (35, 70), (30, 71), (26, 71),
        (22, 70), (19, 69), (16, 68), (14, 66), (12, 64),
        (9, 63), (6, 62), (5, 59), (7, 58), (9, 58),
        (11, 59), (12, 57), (13, 56), (14, 55), (17, 56),
        # Baltic Sea and Gulf of Bothnia indentation.
        (18, 59), (20, 63), (23, 65), (25, 66), (25, 64),
        (23, 62), (21, 60), (24, 60), (28, 61), (30, 60),
        (28, 59), (25, 59), (24, 57), (22, 57), (21, 56),
        (21, 55), (18, 54), (14, 54), (10, 54), (10, 56),
        (11, 57), (10, 58), (8, 57), (8, 55), (8, 54),
        (7, 53), (5, 53), (4, 52), (2, 51), (0, 49),
        (-2, 49), (-5, 48), (-4, 47), (-1, 46), (-1, 44),
        (-8, 44), (-9, 42), (-9, 38),
    ),
    "Australian mainland": (
        (113, -22), (115, -20), (119, -20), (122, -18),
        (124, -15), (129, -15), (130, -12), (132, -11),
        (136, -12), (137, -15), (140, -17), (141, -16),
        (141, -13), (143, -11), (144, -10), (145, -14),
        (146, -18), (150, -23), (153, -27), (153, -29),
        (151, -33), (149, -37), (146, -39), (144, -38),
        (141, -38), (139, -36), (138, -35), (136, -35),
        (134, -33), (131, -32), (126, -32), (122, -34),
        (118, -35), (115, -34), (114, -31), (113, -26),
    ),
    "Antarctic grounded continent, excluding major floating shelves": (
        # Ross Ice Shelf: deep water indentation reaches a guessed grounding
        # line instead of the floating shelf's more northerly seaward edge.
        (-180, -85), (-170, -85), (-160, -85), (-150, -86),
        (-145, -85), (-150, -82), (-151, -79), (-150, -77),
        (-145, -75), (-135, -74), (-125, -73), (-115, -73),
        (-105, -74), (-100, -75), (-90, -74), (-82, -74),
        (-76, -72), (-73, -69), (-70, -67), (-66, -65),
        (-62, -63), (-58, -63), (-57, -65), (-61, -68),
        (-63, -70), (-61, -73), (-59, -75), (-60, -78),
        # Weddell Sea / Filchner-Ronne floating shelves are left as water.
        (-65, -80), (-70, -81), (-72, -82), (-60, -83),
        (-45, -83), (-35, -81), (-30, -79), (-30, -77),
        (-25, -75), (-20, -73), (-10, -71), (0, -70),
        (10, -70), (20, -71), (30, -70), (40, -69),
        (50, -68), (60, -68), (68, -70), (71, -73),
        (74, -72), (75, -69), (80, -67), (90, -66),
        (100, -66), (110, -66), (120, -66), (130, -66),
        (140, -66), (150, -68), (160, -71), (165, -73),
        (170, -76), (165, -78), (160, -80), (160, -82),
        (170, -84), (180, -85), (180, -90), (-180, -90),
    ),
    "Greenland": (
        (-73, 78), (-69, 81), (-61, 82), (-49, 83), (-36, 83),
        (-25, 81), (-19, 79), (-19, 75), (-22, 71), (-25, 69),
        (-32, 66), (-40, 65), (-43, 61), (-45, 60), (-49, 62),
        (-52, 65), (-53, 68), (-57, 71), (-54, 74), (-62, 76),
        (-68, 76),
    ),
    # Canadian Arctic islands are separate approximations, not a filled-in
    # archipelago envelope. Narrow channels may still be lost at this scale.
    "Ellesmere Island": (
        (-91, 77), (-88, 80), (-82, 82), (-74, 83), (-66, 82),
        (-62, 81), (-66, 79), (-72, 78), (-77, 76), (-83, 76),
    ),
    "Axel Heiberg Island": (
        (-97, 78), (-94, 81), (-89, 81), (-87, 79), (-91, 78),
    ),
    "Devon Island": (
        (-96, 75), (-92, 77), (-85, 77), (-80, 75), (-83, 74),
        (-90, 74),
    ),
    "Baffin Island": (
        (-80, 73), (-75, 73), (-71, 71), (-67, 69), (-64, 67),
        (-62, 65), (-66, 63), (-70, 64), (-73, 66), (-76, 67),
        (-78, 70),
    ),
    "Banks Island": (
        (-125, 72), (-122, 75), (-117, 75), (-115, 73),
        (-120, 71), (-123, 71),
    ),
    "Victoria Island": (
        (-119, 70), (-116, 73), (-112, 73), (-110, 72),
        (-106, 73), (-103, 71), (-106, 69), (-113, 69),
    ),
    "Melville Island": (
        (-118, 75), (-115, 77), (-109, 77), (-105, 75), (-111, 74),
    ),
    "Prince Patrick Island": (
        (-123, 76), (-121, 78), (-118, 77), (-118, 75), (-121, 75),
    ),
    "Bathurst Island": (
        (-103, 75), (-102, 77), (-98, 77), (-97, 75), (-100, 74),
    ),
    "Prince of Wales Island": (
        (-102, 72), (-100, 74), (-97, 74), (-96, 72), (-99, 71),
    ),
    "Somerset Island": (
        (-95, 72), (-95, 74), (-91, 74), (-90, 72), (-93, 71),
    ),
    "Southampton Island": (
        (-87, 64), (-85, 66), (-81, 65), (-82, 63), (-85, 63),
    ),
    "Newfoundland": (
        (-59, 48), (-57, 50), (-55, 51.5), (-53, 49),
        (-53, 47), (-56, 47),
    ),
    "Vancouver Island": (
        (-128, 51), (-125, 50), (-123, 48.3), (-125, 48.3),
    ),
    "Haida Gwaii": ((-133, 54), (-131, 54), (-131, 52), (-132, 52)),
    "Kodiak Island": ((-155, 58), (-152, 58), (-152, 57), (-154, 56)),
    "Unimak Island": ((-165, 55), (-163, 55), (-164, 54), (-166, 54)),
    "Unalaska Island": ((-168, 54), (-166, 54), (-167, 53), (-169, 53)),
    "Adak Island": ((-177, 52.2), (-176, 52.2), (-176, 51.5), (-177, 51.5)),
    "Attu Island": ((172, 53.1), (174, 53.1), (174, 52.5), (172, 52.5)),
    "Iceland": (
        (-24, 65), (-22, 66.5), (-18, 66.5), (-14, 65.5),
        (-13, 64.5), (-18, 63.3), (-22, 63.5),
    ),
    "Great Britain": (
        (-6, 58), (-4, 59), (-2, 58), (-2, 56), (0, 54),
        (0, 53), (2, 52), (1, 51), (-1, 50), (-5.5, 50),
        (-4, 52), (-5, 53), (-3, 54), (-5, 56),
    ),
    "Ireland": (
        (-10.5, 52), (-10, 54), (-8, 55.5), (-6, 55),
        (-6, 52), (-8, 51.5),
    ),
    "Svalbard, Spitsbergen": (
        (10, 79), (13, 80), (17, 80), (18, 78), (16, 76.5), (13, 77),
    ),
    "Svalbard, Nordaustlandet": ((19, 80.5), (25, 80.5), (26, 79), (21, 79)),
    "Novaya Zemlya, south island": (
        (51, 71), (55, 73), (57, 73), (56, 71), (53, 70.5),
    ),
    "Novaya Zemlya, north island": (
        (55, 74), (58, 76), (66, 77), (68, 76), (62, 74), (58, 73),
    ),
    "Franz Josef Land, western large islands": (
        (44, 80.5), (48, 81.5), (51, 80.5), (49, 80),
    ),
    "Franz Josef Land, central large islands": (
        (53, 81.5), (58, 81.5), (60, 80), (56, 80),
    ),
    "Franz Josef Land, eastern large island": (
        (61, 81), (65, 81), (65, 80), (62, 80),
    ),
    "Severnaya Zemlya, October Revolution Island": (
        (95, 80), (98, 81), (101, 80), (99, 78.5), (96, 79),
    ),
    "Severnaya Zemlya, Bolshevik Island": (
        (100, 79), (103, 79.5), (106, 78), (103, 77.5), (100, 78),
    ),
    "Severnaya Zemlya, Komsomolets Island": (
        (93, 81), (96, 81.5), (99, 81), (97, 80.5), (94, 80.5),
    ),
    "New Siberian Islands, Kotelny": (
        (137, 74), (139, 76), (144, 76), (145, 74), (141, 73),
    ),
    "New Siberian Islands, New Siberia": (
        (146, 75.5), (150, 75.5), (151, 74), (148, 74),
    ),
    "New Siberian Islands, Lyakhovsky": (
        (139, 74), (143, 74), (144, 73), (140, 72.5),
    ),
    "Wrangel Island": ((178, 71.7), (182, 71.7), (181, 70.5), (178, 70.5)),
    "Sardinia": ((8, 41.3), (10, 41), (10, 39), (8, 39)),
    "Corsica": ((8.5, 43), (9.5, 43), (9.5, 41.5), (8.5, 41.5)),
    "Sicily": ((12, 38), (15.5, 38), (15, 36.5), (13, 37)),
    "Crete": ((23, 35.8), (26.5, 35.5), (26, 34.8), (23.5, 35)),
    "Cyprus": ((32, 35), (34.5, 35.7), (34.5, 34.8), (32, 34.5)),
    "Mallorca": ((2.3, 39.9), (3.6, 39.9), (3.4, 39.3), (2.5, 39.3)),
    "Cuba": (
        (-85, 22), (-82, 23.5), (-79, 22.5), (-75, 21.5),
        (-74, 20), (-77, 20), (-81, 22), (-84, 21.5),
    ),
    "Hispaniola": ((-74.5, 19), (-72, 20), (-68, 19), (-69, 18), (-73, 18)),
    "Jamaica": ((-78.5, 18.5), (-76, 18.5), (-76.3, 17.7), (-78, 17.7)),
    "Puerto Rico": ((-67.3, 18.6), (-65.5, 18.5), (-65.6, 17.9), (-67.2, 17.9)),
    "Bahamas, Andros": ((-78.3, 25.2), (-77.6, 25.2), (-77.6, 23.7), (-78.2, 23.7)),
    "Trinidad": ((-61.9, 10.9), (-61, 10.9), (-60.9, 10), (-61.8, 10)),
    "Tierra del Fuego": (
        (-74, -53), (-70, -52.5), (-67, -54), (-65, -55),
        (-69, -56), (-72, -55),
    ),
    "Falkland Islands, west": ((-61.5, -51), (-60, -51), (-59.5, -52.5), (-61, -52.5)),
    "Falkland Islands, east": ((-59.5, -51), (-57.5, -51.5), (-58, -52.5), (-59.5, -52)),
    "South Georgia": ((-38.5, -54), (-35.5, -54), (-35, -55), (-37, -55)),
    "Galapagos, Isabela": ((-91.6, 0.2), (-91, 0.2), (-90.8, -1.2), (-91.5, -1.2)),
    "Madagascar": (
        (43, -22), (44, -17), (47, -13), (49, -12), (50, -15),
        (49, -19), (47, -24), (45, -26), (43, -25),
    ),
    "Sri Lanka": ((79.5, 9.8), (81, 9), (82, 7), (80.5, 5.8), (79.5, 7)),
    "Taiwan": ((120, 23), (121, 25.5), (122, 25), (121.5, 22), (120.5, 22)),
    "Hainan": ((108.5, 20), (110.5, 20.5), (111, 19), (109.5, 18), (108.5, 19)),
    "Sakhalin": ((141, 54), (143, 54), (144, 51), (143, 49), (143, 46), (141.5, 47), (142, 50)),
    "Japan, Hokkaido": (
        (140, 42), (141, 44), (142, 45.5), (145, 44),
        (146, 43), (143, 42), (142, 41.5),
    ),
    "Japan, Honshu": (
        (131, 34), (134, 34), (137, 35), (140, 36), (141, 38),
        (141.5, 41), (140, 41), (139, 39), (137, 37),
        (134, 35.5), (132, 35),
    ),
    "Japan, Kyushu": ((129, 33), (130, 34), (132, 33), (131, 31), (130, 30.5)),
    "Japan, Shikoku": ((132, 34), (134.5, 34.5), (135, 33.5), (133, 32.8)),
    "Kuril Islands, Iturup": ((147, 45.7), (149, 45.2), (148, 44.5), (146.5, 45)),
    "Philippines, Luzon": (
        (120, 19), (122, 19), (123, 17), (122, 15),
        (124, 13), (122, 13), (120, 15),
    ),
    "Philippines, Mindanao": (
        (122, 8), (124, 9.5), (126, 9), (126, 6),
        (124, 5.5), (123, 7), (122, 7),
    ),
    "Philippines, Samar": ((124, 13), (125.5, 12), (125.5, 11), (124, 11)),
    "Philippines, Leyte": ((124, 11.5), (125.2, 11.5), (125.3, 10), (124.5, 10)),
    "Philippines, Panay": ((121.8, 11.9), (123.2, 11.6), (122.8, 10.5), (122, 10.5)),
    "Philippines, Negros": ((122.5, 11), (123.5, 11), (123.3, 9), (122.5, 9.5)),
    "Philippines, Palawan": ((119, 11.5), (119.7, 10.5), (117.5, 7.5), (117, 8.5)),
    "Sumatra": (
        (95, 5.5), (97, 5), (99, 2), (102, 0), (104, -2),
        (106, -5), (105, -6), (102, -4), (99, -1), (96, 2),
    ),
    "Java": ((105, -6), (108, -6), (111, -7), (114.5, -7.5), (114, -9), (110, -8.5), (106, -7.5)),
    "Borneo": (
        (109, 1), (111, 3), (114, 4), (117, 7), (119, 6),
        (118, 2), (117, -1), (116, -4), (112, -4), (110, -2),
    ),
    "Sulawesi": (
        (119, -6), (121, -6), (122, -4), (123, -5), (124, -4),
        (123, -2), (122, -1), (125, 0), (125, 2), (123, 1),
        (121, 1), (120, 0), (119, -2),
    ),
    "Bali": ((114.5, -8), (115.7, -8), (115.5, -8.8), (114.6, -8.8)),
    "Lombok": ((115.9, -8), (116.7, -8), (116.6, -9), (116, -8.8)),
    "Sumbawa": ((117, -8), (119, -8), (119, -9), (117, -9)),
    "Flores": ((119.7, -8), (123, -8), (123, -8.8), (120, -8.8)),
    "Sumba": ((119, -9.2), (120.8, -9.2), (120.5, -10.2), (119, -10)),
    "Timor": ((123, -10), (125, -9), (127, -8.3), (126.5, -9.5), (124, -10.5)),
    "Halmahera": ((127, 2), (128.5, 2), (128.8, 0), (127.8, -1), (127, 0)),
    "Seram": ((127.5, -2.8), (130.8, -2.8), (130.5, -3.8), (128, -3.7)),
    "New Guinea": (
        (130, -1), (133, -0.5), (135, -2), (138, -2),
        (142, -3), (146, -5), (148, -6), (148, -8),
        (151, -10), (149, -11), (146, -9), (143, -8),
        (140, -9), (137, -8), (135, -5), (133, -4), (131, -2),
    ),
    "New Britain": ((148, -5), (151, -4), (153, -5), (152, -6), (149, -6)),
    "New Ireland": ((151, -3), (153, -3), (153.5, -4.5), (152, -4)),
    "Bougainville": ((154.5, -5), (156, -5), (156, -7), (155, -7)),
    "Solomon Islands, Guadalcanal": ((159.5, -9), (161, -9), (161, -10), (160, -10)),
    "Tasmania": ((144, -41), (146, -40.5), (148.5, -41), (148, -43), (146, -43.5), (144.5, -42)),
    "New Zealand, North Island": (
        (172.5, -34.5), (174, -35), (175, -37), (178, -37.5),
        (178.5, -39), (176, -41), (174.5, -41.5), (174, -39),
    ),
    "New Zealand, South Island": (
        (173, -40.5), (174.5, -41.5), (173, -43), (171, -45),
        (168, -47), (166, -46), (168, -44), (171, -42),
    ),
    "New Caledonia": ((164, -20), (167, -21), (167.5, -22.5), (166, -22.5), (164, -21)),
    "Fiji, Viti Levu": ((177, -17.5), (178.5, -17.5), (178.5, -18.5), (177, -18.5)),
    "Fiji, Vanua Levu": ((178.5, -16.2), (180.5, -16.2), (180, -17), (179, -17)),
    "Hawaii, Hawaii Island": ((-156.1, 20.2), (-155.2, 20.3), (-154.8, 19.5), (-155.6, 18.9), (-156.2, 19.4)),
    "Hawaii, Maui": ((-156.7, 21), (-156, 21), (-155.9, 20.6), (-156.6, 20.6)),
    "Kerguelen, main island": ((68.5, -48.5), (70.5, -49), (70, -50), (69, -50)),
}

# Inland lakes are deliberately NOT cut out. The Black Sea is connected to
# the ocean and is water under the experiment's definition.
SEA_CUTOUTS: Dict[str, Polygon] = {
    "Black Sea and Sea of Azov": (
        (27.5, 42), (29, 44), (31, 46), (33, 46), (35, 45),
        (37, 46), (39, 47), (39, 45), (42, 42), (40, 41),
        (35, 41), (31, 41), (29, 41),
    ),
}


class BoundedPolygon(NamedTuple):
    name: str
    vertices: Polygon
    min_lon: float
    max_lon: float
    min_lat: float
    max_lat: float


def prepare_polygons(source: Dict[str, Polygon]) -> Tuple[BoundedPolygon, ...]:
    """Attach bounding boxes to the handwritten rules; never load external data."""
    result = []
    for name, vertices in source.items():
        if len(vertices) < 3:
            raise ValueError(f"Too few vertices in {name}")
        if any(not -90 <= lat <= 90 for _, lat in vertices):
            raise ValueError(f"Invalid latitude in {name}")
        result.append(BoundedPolygon(
            name, vertices,
            min(lon for lon, _ in vertices),
            max(lon for lon, _ in vertices),
            min(lat for _, lat in vertices),
            max(lat for _, lat in vertices),
        ))
    return tuple(result)


def point_in_polygon(lon: float, lat: float, vertices: Polygon) -> bool:
    """Ray-crossing test; points exactly on a polygon edge count as inside."""
    inside = False
    x1, y1 = vertices[-1]
    for x2, y2 in vertices:
        cross = (lon - x1) * (y2 - y1) - (lat - y1) * (x2 - x1)
        if (abs(cross) <= 1e-9
                and min(x1, x2) <= lon <= max(x1, x2)
                and min(y1, y2) <= lat <= max(y1, y2)):
            return True
        if (y1 > lat) != (y2 > lat):
            intersection_lon = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if lon < intersection_lon:
                inside = not inside
        x1, y1 = x2, y2
    return inside


def in_any_polygon(lon: float, lat: float, polygons: Tuple[BoundedPolygon, ...]) -> bool:
    """Try equivalent longitudes so islands/mainlands can cross the date line."""
    for polygon in polygons:
        if not polygon.min_lat <= lat <= polygon.max_lat:
            continue
        for wrapped_lon in (lon, lon - 360, lon + 360):
            if (polygon.min_lon <= wrapped_lon <= polygon.max_lon
                    and point_in_polygon(wrapped_lon, lat, polygon.vertices)):
                return True
    return False


def classify_point(lon: float, lat: float,
                   land: Tuple[BoundedPolygon, ...],
                   seas: Tuple[BoundedPolygon, ...]) -> int:
    """One deterministic rule evaluation, not a separate model inference."""
    return int(in_any_polygon(lon, lat, land) and not in_any_polygon(lon, lat, seas))


def make_matrix() -> List[List[int]]:
    land = prepare_polygons(LAND_POLYGONS)
    seas = prepare_polygons(SEA_CUTOUTS)
    return [
        [classify_point(lon, lat, land, seas) for lon in LONGITUDES]
        for lat in LATITUDES
    ]


def validate_matrix(matrix: List[List[int]]) -> None:
    if LATITUDES != tuple(89 - 2 * row for row in range(90)):
        raise ValueError("Latitude sequence is incorrect")
    if LONGITUDES != tuple(-179 + 2 * col for col in range(180)):
        raise ValueError("Longitude sequence is incorrect")
    if len(matrix) != 90 or any(len(row) != 180 for row in matrix):
        raise ValueError("Matrix must be 90 rows by 180 columns")
    if any(type(value) is not int or value not in (0, 1)
           for row in matrix for value in row):
        raise ValueError("Matrix contains a non-binary or missing value")


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    checksum = zlib.crc32(kind + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", checksum)


def write_png(path: Path, matrix: List[List[int]], scale: int) -> None:
    """Write 8-bit grayscale PNG, copying each matrix cell to a scale-square.

    A value of 1 is white (255); 0 is black (0). Exact pixel replication is
    nearest-neighbor enlargement. No smoothing, correction, or overlays occur.
    PNG's zlib compression is lossless and does not change any pixel values.
    """
    width = len(matrix[0]) * scale
    height = len(matrix) * scale
    scanlines = bytearray()
    for row in matrix:
        pixels = b"".join(bytes([255 * value]) * scale for value in row)
        # Filter 0 leaves the row's pixel bytes unchanged.
        scanline = b"\x00" + pixels
        scanlines.extend(scanline * scale)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", zlib.compress(bytes(scanlines), 9))
        + png_chunk(b"IEND", b"")
    )


def read_generated_png(path: Path) -> Tuple[int, int, List[bytes]]:
    """Decode these PNG files for verification, including chunk checksums."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Not a PNG: {path}")
    position = 8
    compressed = bytearray()
    width = height = 0
    ended = False
    while position < len(data):
        length = struct.unpack_from(">I", data, position)[0]
        kind = data[position + 4:position + 8]
        payload = data[position + 8:position + 8 + length]
        checksum = struct.unpack_from(">I", data, position + 8 + length)[0]
        if checksum != (zlib.crc32(kind + payload) & 0xFFFFFFFF):
            raise ValueError(f"PNG checksum mismatch: {path}")
        position += 12 + length
        if kind == b"IHDR":
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
            if (depth, color, compression, filtering, interlace) != (8, 0, 0, 0, 0):
                raise ValueError(f"Unexpected PNG encoding: {path}")
        elif kind == b"IDAT":
            compressed.extend(payload)
        elif kind == b"IEND":
            ended = True
            break
    if not ended or position != len(data) or not width or not height:
        raise ValueError(f"Incomplete PNG: {path}")
    raw = zlib.decompress(bytes(compressed))
    if len(raw) != (width + 1) * height:
        raise ValueError(f"Incorrect pixel count: {path}")
    rows = []
    for offset in range(0, len(raw), width + 1):
        if raw[offset] != 0:
            raise ValueError(f"Unexpected PNG row filter: {path}")
        row = raw[offset + 1:offset + 1 + width]
        if not set(row).issubset({0, 255}):
            raise ValueError(f"PNG contains a non-black/non-white pixel: {path}")
        rows.append(row)
    return width, height, rows


def verify_outputs(output_dir: Path, matrix: List[List[int]]) -> Dict[str, object]:
    """Verify saved CSV and every saved pixel, not just the in-memory matrix."""
    validate_matrix(matrix)
    with (output_dir / "land_water_matrix.csv").open(newline="", encoding="ascii") as file:
        saved_rows = list(csv.reader(file))
    if len(saved_rows) != 90 or any(len(row) != 180 for row in saved_rows):
        raise ValueError("Saved CSV must be 90 by 180")
    if any(value not in ("0", "1") for row in saved_rows for value in row):
        raise ValueError("Saved CSV contains a header, blank, or non-binary value")
    if [[int(value) for value in row] for row in saved_rows] != matrix:
        raise ValueError("CSV differs from the generated matrix")

    small_width, small_height, small_rows = read_generated_png(output_dir / "world_180x90.png")
    big_width, big_height, big_rows = read_generated_png(output_dir / "world_1440x720.png")
    if (small_width, small_height) != (180, 90):
        raise ValueError("Original image must be 180 by 90")
    if (big_width, big_height) != (1440, 720):
        raise ValueError("Enlarged image must be 1440 by 720")
    for y in range(90):
        for x in range(180):
            expected = 255 * matrix[y][x]
            if small_rows[y][x] != expected:
                raise ValueError(f"Original image differs from CSV at row {y}, column {x}")
            for big_y in range(y * SCALE, (y + 1) * SCALE):
                block_row = big_rows[big_y][x * SCALE:(x + 1) * SCALE]
                if any(pixel != expected for pixel in block_row):
                    raise ValueError(f"Nearest-neighbor mismatch at row {y}, column {x}")

    land_count = sum(sum(row) for row in matrix)
    return {
        "matrix_rows": 90,
        "matrix_columns": 180,
        "valid_values": 90 * 180,
        "land_points": land_count,
        "water_points": 90 * 180 - land_count,
        "original_png_size": [small_width, small_height],
        "enlarged_png_size": [big_width, big_height],
        "pixel_values": sorted({pixel for row in big_rows for pixel in row}),
        "nearest_neighbor_scale": SCALE,
        "all_8x8_blocks_match": True,
        "handwritten_land_polygons": len(LAND_POLYGONS),
        "handwritten_sea_cutouts": len(SEA_CUTOUTS),
        "geographic_accuracy_measured": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir", type=Path, default=Path(__file__).resolve().parent,
        help="Directory for the CSV and both PNG files (default: script directory)",
    )
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    matrix = make_matrix()
    validate_matrix(matrix)
    with (args.output_dir / "land_water_matrix.csv").open("w", newline="", encoding="ascii") as file:
        csv.writer(file, lineterminator="\n").writerows(matrix)
    write_png(args.output_dir / "world_180x90.png", matrix, 1)
    write_png(args.output_dir / "world_1440x720.png", matrix, SCALE)
    report = verify_outputs(args.output_dir, matrix)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
