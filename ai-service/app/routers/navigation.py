"""
NaviSense · Module A: Graph-Based Navigation & A* Pathfinding
═════════════════════════════════════════════════════════════
DSA used:
  • Weighted Graph     — map as adjacency list: intersections=nodes, streets=edges
  • Min-Heap (heapq)   — priority queue powering A* open set
  • A* Search          — heuristic shortest-path; faster than Dijkstra for goal-directed nav
  • Spatial Hashing    — O(1) average lookup of nearby landmarks

Real map data should be sourced from OpenStreetMap (OSMnx library) and converted
into this graph representation at build time, then stored in the Supabase DB.
"""
import heapq
import math
from typing import Optional
from dataclasses import dataclass, field

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from loguru import logger

router = APIRouter()


# ══════════════════════════════════════════════════════════════
#  DATA STRUCTURES
# ══════════════════════════════════════════════════════════════

@dataclass
class Node:
    """
    Represents a map intersection (graph vertex).
    Stored in the graph's adjacency list as dict keys.
    """
    node_id: str
    lat: float
    lon: float
    label: Optional[str] = None          # e.g., "Main St & Park Ave"
    is_accessible: bool = True           # False if no kerb-cut / tactile paving


@dataclass(order=True)
class PriorityItem:
    """Wrapper for heapq — Python's heapq is a min-heap by default."""
    priority: float
    node_id: str = field(compare=False)


class WeightedGraph:
    """
    Directed weighted graph (adjacency list) for pedestrian map navigation.

    Nodes   → intersections / waypoints
    Edges   → street segments with composite weight:
                  w = distance_m + penalty_for_inaccessible_path

    Space complexity: O(V + E)
    """

    def __init__(self):
        # adjacency_list[node_id] = [(neighbour_id, weight), ...]
        self.adjacency_list: dict[str, list[tuple[str, float]]] = {}
        self.nodes: dict[str, Node] = {}

    def add_node(self, node: Node) -> None:
        self.nodes[node.node_id] = node
        if node.node_id not in self.adjacency_list:
            self.adjacency_list[node.node_id] = []

    def add_edge(self, from_id: str, to_id: str, weight: float) -> None:
        """Add a directed edge. Call twice for bidirectional streets."""
        if from_id not in self.adjacency_list:
            self.adjacency_list[from_id] = []
        self.adjacency_list[from_id].append((to_id, weight))

    def get_neighbours(self, node_id: str) -> list[tuple[str, float]]:
        return self.adjacency_list.get(node_id, [])


class SpatialHashMap:
    """
    Spatial Hashing for O(1) average-case lookup of nearby landmarks.
    Divides the world into a grid; each cell holds a list of landmarks.

    cell_size_deg ≈ 0.001° ≈ 111 m at the equator — tune per city density.
    """

    def __init__(self, cell_size_deg: float = 0.001):
        self._cell_size = cell_size_deg
        self._buckets: dict[tuple[int, int], list[dict]] = {}

    def _hash(self, lat: float, lon: float) -> tuple[int, int]:
        return (int(lat / self._cell_size), int(lon / self._cell_size))

    def insert(self, lat: float, lon: float, landmark: dict) -> None:
        key = self._hash(lat, lon)
        self._buckets.setdefault(key, []).append(landmark)

    def query_nearby(self, lat: float, lon: float, radius_cells: int = 1) -> list[dict]:
        """Return all landmarks within a square neighbourhood of radius_cells."""
        cx, cy = self._hash(lat, lon)
        results = []
        for dx in range(-radius_cells, radius_cells + 1):
            for dy in range(-radius_cells, radius_cells + 1):
                results.extend(self._buckets.get((cx + dx, cy + dy), []))
        return results


# ══════════════════════════════════════════════════════════════
#  A* ALGORITHM
# ══════════════════════════════════════════════════════════════

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Haversine formula — great-circle distance in metres.
    Used as the admissible heuristic h(n) for A*.
    h(n) ≤ true cost guarantees A* finds the optimal path.
    """
    R = 6_371_000  # Earth radius in metres
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lon2 - lon1)
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def a_star(
    graph: WeightedGraph,
    start_id: str,
    goal_id: str,
    accessibility_penalty: float = 500.0,   # metres added for inaccessible paths
) -> tuple[list[str], float]:
    """
    A* Search Algorithm — finds the shortest SAFE walking path.

    Heuristic h(n): haversine distance to goal (admissible — never overestimates).
    g(n): actual cumulative cost from start.
    f(n) = g(n) + h(n): priority key in min-heap.

    Accessibility penalty: adds virtual cost for paths lacking tactile paving
    or kerb cuts, guiding blind users toward safer routes.

    Time complexity:  O(E log V) — dominated by heap operations
    Space complexity: O(V)       — open set + came_from dict

    Returns:
        (path: list of node IDs, total_cost: float)
        Raises ValueError if no path exists.
    """
    if start_id not in graph.nodes or goal_id not in graph.nodes:
        raise ValueError(f"Node not found: start={start_id}, goal={goal_id}")

    goal_node = graph.nodes[goal_id]

    # g_score[n] = cheapest known cost from start to n
    g_score: dict[str, float] = {start_id: 0.0}

    # came_from[n] = predecessor on cheapest path
    came_from: dict[str, Optional[str]] = {start_id: None}

    # Min-heap: (f_score, node_id)
    open_heap: list[PriorityItem] = [PriorityItem(priority=0.0, node_id=start_id)]

    while open_heap:
        current = heapq.heappop(open_heap).node_id

        if current == goal_id:
            # Reconstruct path by tracing came_from back to start
            path: list[str] = []
            node: Optional[str] = goal_id
            while node is not None:
                path.append(node)
                node = came_from[node]
            path.reverse()
            return path, g_score[goal_id]

        for neighbour_id, edge_weight in graph.get_neighbours(current):
            neighbour_node = graph.nodes.get(neighbour_id)
            if neighbour_node is None:
                continue  # dangling edge — skip safely

            # Apply accessibility penalty for routes lacking tactile infrastructure
            effective_weight = edge_weight
            if not neighbour_node.is_accessible:
                effective_weight += accessibility_penalty

            tentative_g = g_score[current] + effective_weight

            if tentative_g < g_score.get(neighbour_id, math.inf):
                came_from[neighbour_id] = current
                g_score[neighbour_id] = tentative_g
                h = haversine_distance(
                    neighbour_node.lat, neighbour_node.lon,
                    goal_node.lat, goal_node.lon
                )
                f = tentative_g + h
                heapq.heappush(open_heap, PriorityItem(priority=f, node_id=neighbour_id))

    raise ValueError(f"No path found from {start_id} to {goal_id}")


# ══════════════════════════════════════════════════════════════
#  API ENDPOINTS
# ══════════════════════════════════════════════════════════════

class NavigationRequest(BaseModel):
    start_node_id: str = Field(..., example="node_101")
    goal_node_id: str = Field(..., example="node_205")
    prefer_accessible: bool = True


class NavigationStep(BaseModel):
    node_id: str
    label: Optional[str]
    lat: float
    lon: float


class NavigationResponse(BaseModel):
    path: list[NavigationStep]
    total_distance_m: float
    step_count: int


# ── In-memory demo graph (replace with Supabase-backed loader in production) ──
_demo_graph = WeightedGraph()
for n in [
    Node("node_101", 28.6139, 77.2090, "Connaught Place"),
    Node("node_102", 28.6150, 77.2095, "Janpath"),
    Node("node_103", 28.6160, 77.2100, "Central Park Gate"),
    Node("node_205", 28.6170, 77.2110, "Rajiv Chowk Metro"),
]:
    _demo_graph.add_node(n)
_demo_graph.add_edge("node_101", "node_102", 120.0)
_demo_graph.add_edge("node_102", "node_103", 90.0)
_demo_graph.add_edge("node_103", "node_205", 150.0)
_demo_graph.add_edge("node_101", "node_103", 250.0)   # shortcut


@router.post("/path", response_model=NavigationResponse, summary="Calculate safest walking path (A*)")
async def get_safe_path(req: NavigationRequest):
    """
    Runs A* on the pedestrian graph and returns turn-by-turn waypoints.

    ERROR HANDLING: If the destination is unreachable (graph disconnected,
    node not found) we return HTTP 404 so the mobile client can prompt
    the user to recalibrate their GPS location.
    """
    try:
        path_ids, total_cost = a_star(_demo_graph, req.start_node_id, req.goal_node_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    steps = [
        NavigationStep(
            node_id=nid,
            label=_demo_graph.nodes[nid].label,
            lat=_demo_graph.nodes[nid].lat,
            lon=_demo_graph.nodes[nid].lon,
        )
        for nid in path_ids
        if nid in _demo_graph.nodes
    ]

    return NavigationResponse(
        path=steps,
        total_distance_m=round(total_cost, 1),
        step_count=len(steps),
    )
