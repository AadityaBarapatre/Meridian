# Meridian — Real-Time Paper Trading Terminal & Order Matching Engine

> **Academic Alignment:** Course Code: **24EE05TH0505 – 2** (Program Elective – 1)  
> **Course:** Data Structures and Algorithms — Semester V, B. Tech. (Electronics and Communication Engineering)

---

## 1. Problem Statement

Modern electronic financial exchanges, cryptocurrency brokerages, and algorithmic trading systems handle tens of thousands of orders per second. In such high-frequency, low-latency environments, system performance is strictly bounded by the time and space complexity of its core data structures.

### The Engineering Bottlenecks of Naive Implementations:
1. **Linear Order Books ($O(N)$ Overhead):** Storing resting limit orders in linear arrays or unsorted linked lists requires $O(N)$ linear scans to locate best bids/asks, insert new price levels, or match incoming orders. At scale, this introduces severe execution latency and price slippage.
2. **Continuous Re-Sorting Costs ($O(N \log N)$):** Re-sorting the order book upon every incoming order, price update, or cancellation introduces an unacceptable $O(N \log N)$ computational tax on every tick.
3. **Inefficient Order Cancellations ($O(N)$):** When a trader cancels a resting order, searching through an array or single linked list to find and remove the order takes linear time, degrading throughput during market volatility.
4. **Memory Churn and Garbage Collection Spikes:** Unbounded dynamic allocations for high-frequency time & sales feeds cause continuous heap fragmentation and unpredictable runtime Garbage Collection (GC) pauses, destroying deterministic latency guarantees.
5. **Floating-Point Representation Hazards:** Representing monetary values in standard IEEE-754 double-precision floating-point numbers introduces binary representation errors and rounding divergence across high-volume trade executions.

---

## 2. The Solution: Meridian

**Meridian** is a full-stack, low-latency paper trading terminal and deterministic order matching engine designed to solve these exact algorithmic challenges. Built without external data structure libraries, Meridian implements handcrafted, mathematically proven data structures to achieve optimal asymptotic time and space bounds:

- **$O(\log P)$ Order Insertion & Best-Price Querying:** A self-balancing **Treap (Cartesian Binary Search Tree + Heap)** organizes price levels with randomized rebalancing via split/merge operations (tree rotations).
- **$O(1)$ Price-Time Priority Execution:** A custom **Doubly Linked List** at each price tier enforces fair First-In, First-Out (FIFO) queue semantics and enables $O(1)$ node unlinking for order cancellations.
- **$O(1)$ Instantaneous Order Lookup & Removal:** A **Hash Table** index maps unique order IDs directly to memory node pointers, eliminating linear search during order cancellations.
- **$O(1)$ Bounded-Memory Trade Logging:** A fixed-capacity **Circular Queue (Ring Buffer)** logs the trade tape with zero reallocations, overwriting the oldest entries dynamically.
- **$O(K)$ Ticker Autocomplete & Routing:** A **Trie (Prefix Tree)** index provides instant prefix lookups and symbol discovery.
- **Zero-Loss Fixed-Point Math:** All currency calculations operate purely in integer cents, guaranteeing zero floating-point accumulation error.

---

## 3. Syllabus & Course Curriculum Alignment

This project comprehensively demonstrates and applies the core theoretical and practical competencies defined in the **B.Tech. ECE Semester V Data Structures and Algorithms** syllabus:

### Course Outcomes (CO) Matrix

| Course Outcome | Academic Competency | Implementation in Meridian |
|---|---|---|
| **CO-1** | Analyze the efficiency of algorithms by evaluating time & space complexities | Every engine operation is benchmarked with formal Big-$O$ complexity bounds ($O(1)$ unlinking, $O(\log P)$ Treap operations, $O(K)$ Trie traversals, bounded $O(C)$ buffers). |
| **CO-2** | Design solutions using linear data structures (stacks & queues) | Custom Doubly Linked List FIFO queue (`PriceLevel`), Circular Ring Buffer (`CircularQueue`), and order matching FIFO queues. |
| **CO-3** | Implement real-life problems using arrays & linked lists with dynamic memory allocation | Bidirectional node pointer management (`OrderNode`), linked structure unlinking without array compaction, dynamic node allocation. |
| **CO-4** | Demonstrate nonlinear data structures and their operations (trees & graphs) | Self-balancing Treap (`PriceTree`) with BST search and randomized heap invariants, tree traversals (In-order / Reverse In-order), Trie prefix tree with DFS traversal. |
| **CO-5** | Apply searching, sorting, and hashing techniques for efficient data retrieval | Hash Map indexing (`Engine.index`), BST search (`PriceTree.get`), $O(N)$ In-order depth retrieval, Trie prefix search, integer hashing. |

---

### Detailed Unit-by-Unit Topic Mapping

```
                                      MERIDIAN CORE ENGINE
                                                │
         ┌──────────────────┬───────────────────┼───────────────────┬──────────────────┐
         │                  │                   │                   │                  │
      UNIT-I             UNIT-II             UNIT-III            UNIT-IV            UNIT-V
  Linear Structures       Trees             Traversals      Hashing & Sorting  Advanced Structures
  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
  │• Doubly-LL    │  │• Self-Balanc- │  │• Depth-First  │  │• Hash Tables  │  │• Trie Prefix  │
  │  (PriceLevel) │  │  ing BST      │  │  Search (DFS) │  │  (Order Index)│  │  Tree (Routes)│
  │• Circular     │  │  (Treap)      │  │  in Trie      │  │• In-Order BST │  │• Tradeoff &   │
  │  Queue Buffer │  │• In-Order     │  │• Network      │  │  Sort (Depth) │  │  Data Struc-  │
  │• FIFO Priority│  │  Traversals   │  │  Pub/Sub WS   │  │• Exact Binary │  │  ture Design  │
  │  Queueing     │  │• Tree Rotat-  │  │  Fan-out      │  │  Search & Cent│  │  Selection    │
  │               │  │  ions (Split) │  │               │  │  Arithmetic   │  │               │
  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘
```

#### Unit-I: Data Structures and Applications
- **Circular Queue (Trade Tape Buffer):** Implemented in `CircularQueue<T>` (`server/engine.ts`). Uses a fixed-capacity ring buffer with modulo index calculation `(head + size) % cap` to log the newest 1,000 trades. Avoids array reallocation and memory leaks by overwriting the oldest entries in $O(1)$ time.
- **Doubly Linked List (Price Level Queue):** Implemented in `PriceLevel` (`server/engine.ts`). Each price level holds a doubly linked list of `OrderNode` items with `head`, `tail`, `prev`, and `next` pointers. Implements strict Price-Time priority:
  - Enqueue at tail: $O(1)$
  - Match/Dequeue at head: $O(1)$
  - Arbitrary cancellation: $O(1)$ via node unlinking without traversing the queue.
- **Dynamic Memory & Pointer Allocation:** `OrderNode` pointers dynamically connect orders to parent `PriceLevel` references, allowing instant dereferencing upon execution or cancellation.

#### Unit-II: Trees and Tree-Based Data Structures
- **Self-Balancing Binary Search Tree (Treap: Tree + Heap):** Implemented in `PriceTree` (`server/engine.ts`).
  - **BST Property:** Keyed by integer price in cents. Left children have lower prices; right children have higher prices.
  - **Heap Property:** Each node is assigned a random priority $p \in [0, 1)$. Parent priority is always greater than children priority, preventing tree degradation into a skewed $O(N)$ linked list.
  - **Tree Rotations / Rebalancing:** Implemented cleanly via recursive `split(t, k)` and `merge(a, b)` operations, maintaining expected logarithmic height $O(\log P)$ under arbitrary insertions and deletions.
- **Tree Traversals:**
  - **In-Order Traversal:** Implemented in `PriceTree.top(n, desc)`. Traverses subtrees in-order (or reverse in-order) to extract top $N$ bids (highest first) and top $N$ asks (lowest first) for Level-2 depth snapshots in $O(N)$ time without secondary sorting.
  - **Extremum Search:** `best(max)` iteratively finds the minimum ask or maximum bid by traversing left/right spines in $O(\log P)$ time.

#### Unit-III: Graph Data Structures and Algorithms
- **Graph & Tree Traversals (Depth-First Search - DFS):** Implemented in `Trie.search(prefix)` (`server/engine.ts`). Once the prefix node is reached, a recursive DFS explores descendant edges in lexicographical order, collecting up to $K$ candidate symbols for interactive ticker autocomplete.
- **Network Analysis & Event Distribution:** The real-time WebSocket layer (`server/server.ts`) models a broadcast tree topology, routing price ticks, trade executions, and order book delta snapshots to subscribed client nodes with low-latency pub/sub fan-out.

#### Unit-IV: Sorting, Searching and Hashing
- **Hash Tables & Symbol Dictionaries:**
  - `Engine.index` (`Map<string, OrderNode>`): Hash map mapping order IDs to order nodes in $O(1)$ average time. Enables instant order status lookup and cancellation.
  - `Engine.books` (`Map<string, OrderBook>`): Symbol table routing ticker strings to their corresponding order books.
- **Searching Techniques:**
  - Binary Search Tree lookup in `PriceTree.get(k)` ($O(\log P)$).
  - Prefix search in `Trie.search()` ($O(K)$).
  - Exact key lookup in hash tables ($O(1)$).
- **Sorting Techniques:**
  - Balanced BST in-order traversal yields sorted order book levels in $O(N)$ time, outperforming array comparison sorts ($O(N \log N)$).
  - Internal quicksort/mergesort primitives are used for multi-column portfolio asset allocation and time-series sorting.

#### Unit-V: Advanced Data Structures & Algorithmic Applications
- **Trie Data Structure (Prefix Tree):** Implemented from scratch in `Trie` and `TrieNode` (`server/engine.ts`).
  - Implements `insert(word)` and `search(prefix, limit)`.
  - Enables instant $O(K)$ prefix search and auto-complete for financial ticker symbols (e.g., typing `'N'` immediately matches `'NFLX'` and `'NVDA'`).
- **Data Structure Design Applications:**
  - Comprehensive real-world case study in evaluating and selecting data structures based on time complexity, memory footprint, and access patterns to design a production-grade matching engine.

---

## 4. Algorithmic Complexity Matrix

| Component | Data Structure | Operation | Time Complexity | Space Complexity | Syllabus Alignment |
|---|---|---|---|---|---|
| **Price Index** | Treap (Self-Balancing BST) | Insert Price Level | $O(\log P)$ avg | $O(P)$ | Unit-II (Self-Balancing Trees) |
| **Price Index** | Treap (Self-Balancing BST) | Delete Price Level | $O(\log P)$ avg | $O(P)$ | Unit-II (Tree Rotations) |
| **Price Index** | Treap (Self-Balancing BST) | Lookup Best Bid / Ask | $O(\log P)$ | $O(1)$ | Unit-II (BST Extremum Search) |
| **Order Queue** | Doubly Linked List | Enqueue (Time Priority) | $O(1)$ | $O(1)$ | Unit-I (Linked Lists & Queues) |
| **Order Queue** | Doubly Linked List | Dequeue (Match Fill) | $O(1)$ | $O(1)$ | Unit-I (Queue Operations) |
| **Order Queue** | Doubly Linked List | Arbitrary Order Unlink | $O(1)$ | $O(1)$ | Unit-I (Dynamic Memory & Pointers) |
| **Global Order Index** | Hash Table | Order Lookup by ID | $O(1)$ avg | $O(N)$ | Unit-IV (Hashing & Symbol Tables) |
| **Order Cancellation** | Hash Table + Doubly-LL | Composite Cancel | $O(1)$ | $O(1)$ | Unit-V (Data Structure Design) |
| **Depth Ladder** | Treap Traversal | Top-$K$ Level Extraction | $O(K)$ | $O(K)$ | Unit-II (In-Order Traversal) |
| **Trade History** | Circular Queue | Append Trade Record | $O(1)$ | $O(C)$ fixed | Unit-I (Circular Queue Buffer) |
| **Symbol Autocomplete**| Trie (Prefix Tree) | Prefix Search + DFS | $O(K + M)$ | $O(\Sigma \cdot L)$ | Unit-V (Trie & String Processing) |

*(Where $P$ = distinct active price levels, $N$ = total resting orders, $K$ = prefix length / requested depth, $C$ = fixed circular buffer capacity = 1,000).*

---

## 5. Architectural Data Flow

```
   [ Incoming Order ]
           │
           ▼
   Validate & Scale Price to Integer Cents (No Float Drift)
           │
           ▼
   Search Opposite Book via Treap: best(side)  ───► O(log P)
           │
      ┌────┴──────────────────────────┐
      │ Fills Crossing Spread?        │
      ▼ (Yes)                         ▼ (No / Remainder on LIMIT)
Match against Doubly-LL Head      Insert into Treap via Split/Merge ──► O(log P)
  ├── Decrement Qty               Enqueue into Level Doubly-LL Tail ──► O(1)
  ├── Record to CircularQueue     Register into Hash Table Index    ──► O(1)
  └── Maker Qty == 0?
        ├── Unlink Node ──► O(1)
        └── Level Empty? Remove from Treap ──► O(log P)
```

---

## 6. Key Features

- **High-Performance Matching Engine:** Handcrafted Treap, Doubly Linked List, Hash Index, and Circular Queue executing limit and market orders with strict price-time priority.
- **Stochastic Market Simulator:** Continuous Ornstein–Uhlenbeck log-price process with drifting anchors, volatility shocks, and realistic two-sided order replenishment.
- **Dynamic Candlestick Synthesis:** 8 hours of one-minute OHLCV history pre-generated per symbol, seamlessly rolling into live 250 ms tick updates.
- **Interactive Financial UI:** Glassmorphic terminal with canvas-rendered candlestick charts, exponential moving averages (EMA), volume profiles, interactive crosshairs, and live depth ladders.
- **Full Paper Portfolio:** $100,000 starting equity, margin reservation for resting bids/asks, real-time mark-to-market valuations, allocation charts, and live equity tracking.

---

## 7. Project Structure

```
├── electron/
│   ├── main.cjs            # Electron desktop container (1400x900)
│   └── server.cjs          # Bundled backend production service
├── server/
│   ├── engine.ts           # Handcrafted Data Structures: Treap, Doubly-LL, CircularQueue, Trie
│   ├── market.ts           # Ornstein-Uhlenbeck stochastic price process & synthetic order flow
│   ├── portfolio.ts        # Paper account, buying power reservations & mark-to-market P&L
│   └── server.ts           # Express REST API, WebSocket pub/sub server & market loop
├── src/
│   ├── App.tsx             # Terminal shell, state coordination & WebSocket lifecycle
│   ├── types.ts            # Shared TypeScript data models
│   ├── components/
│   │   ├── CandleChart.tsx     # Canvas OHLCV renderer with EMA & volume overlays
│   │   ├── EquityChart.tsx     # Account equity area chart
│   │   ├── MarketWatch.tsx     # Watchlist with mini sparklines
│   │   ├── OrderBook.tsx       # Live Level-2 depth ladder with cumulative volume bars
│   │   ├── TradeFeed.tsx       # Time & sales tape with live flow meter
│   │   ├── TradePanel.tsx      # Limit and market order execution ticket
│   │   ├── PortfolioView.tsx   # Holdings, allocations, and open orders dashboard
│   │   └── Sparkline.tsx       # Vector trendline generator
│   └── styles/glass.css    # High-density glassmorphism design system
├── test/
│   ├── engine.test.ts      # 8 acceptance tests validating DSA correctness
│   └── market.test.ts      # 8 market simulator and portfolio verification tests
├── index.html              # Single-page web entrypoint
├── package.json            # Scripts and configuration
├── tsconfig.json           # Strict TypeScript configuration
└── vite.config.ts          # Vite bundling pipeline
```

---

## 8. Verification & Test Suite

The project includes acceptance test suites verifying all core data structure invariants:

```bash
npm test
```

### Verified Test Cases:
1. **Price Priority:** Verified that higher bids and lower asks match before less competitive prices.
2. **Time Priority (FIFO):** Verified that identical price levels match older orders first via the Doubly Linked List head.
3. **Partial Fills:** Verified correct remaining quantities in both the resting node and the price level total.
4. **$O(1)$ Cancellation & Empty Node Pruning:** Verified that cancelling unlinks the node in $O(1)$ and prunes empty levels from the Treap.
5. **Market Order Level Sweeping:** Verified aggressive multi-level price sweeps and cancellation of unfilled remainders.
6. **Trie Prefix Autocomplete:** Verified that prefix search `'N'` accurately isolates `'NFLX'` and `'NVDA'` via DFS.
7. **Circular Queue Wrap-Around:** Verified that the 1,001st trade overwrites the oldest trade without buffer growth.
8. **Input Validation:** Verified bounds checking for symbols, sides, prices, and quantities.

---

## 9. Quickstart Guide

### Prerequisites
- Node.js (v18+)
- npm

### Installation & Run

```bash
# 1. Install dependencies
npm install

# 2. Run data structure verification tests
npm test

# 3. Start development server (Backend on :4000, Vite Web on :5173)
npm run dev

# 4. (Optional) Launch as native desktop application
npm run desktop
```

---

## 10. API Specification

### REST Endpoints

| Endpoint | Method | Description | Data Structure Used |
|---|---|---|---|
| `/api/bootstrap` | `GET` | Symbol universe, tickers, sparklines, and portfolio snapshot | Trie, Hash Map |
| `/api/candles/:symbol` | `GET` | 8 hours of one-minute OHLCV candles + live rolling candle | Ring Buffer / Array |
| `/api/book/:symbol` | `GET` | Snapshot of Level-2 market depth (top 15 bids & asks) | Treap In-Order Traversal |
| `/api/orders` | `POST` | Place a limit or market order (`{ symbol, side, type, price, qty }`) | Treap, Doubly-LL, Hash Map |
| `/api/orders/:id` | `DELETE`| Cancel resting order by ID | Hash Map + Doubly-LL ($O(1)$) |
| `/api/portfolio` | `GET` | Cash, positions, open orders, and equity history | Hash Map |
| `/api/portfolio/reset` | `POST`| Reset paper account to initial $100,000 cash | Hash Map |
| `/api/reset` | `POST` | Re-seed the entire market and portfolio state | Treap, Trie, Hash Map |

### WebSocket Protocol (`/ws`)

Clients connect and send `{ type: 'select', symbol: string }` to subscribe to depth updates.

- `{ type: 'ticks', ts, ticks: [...] }` — Broadcast every 250 ms for all tickers.
- `{ type: 'trades', trades: [...] }` — Real-time execution stream extracted from `CircularQueue`.
- `{ type: 'book', ... }` — Subscribed symbol Level-2 depth from `PriceTree.top()`.
- `{ type: 'portfolio', portfolio }` — Mark-to-market portfolio updates pushed every second.

---

## 11. Academic References & Textbooks

1. **Ellis Horowitz, Sartaj Sahni, and Susan Anderson-Freed;** *Fundamentals of Data Structures in C*; Second Edition; Universities Press; 2008.
2. **Robert Kruse, C. L. Tondo, Bruce Leung, and Sashu Mogalla;** *Data Structures and Program Design in C*; Second Edition; Pearson Education; 2006.
3. **Mark Allen Weiss;** *Data Structures and Algorithm Analysis in C*; Second Edition; Pearson Education; 2002.
4. **Thomas H. Cormen, Charles E. Leiserson, Ronald L. Rivest, and Clifford Stein;** *Introduction to Algorithms*; Third Edition; MIT Press / PHI; 2009.
