```plantuml
@startuml
Alice -> Bob: Authentication Request
Bob --> Alice: Authentication Response
@enduml
```


```d2
client -> api: GET /users
api -> db: Query
db -> api: Records
api -> client: JSON Response
```

```mermaid
sequenceDiagram
    participant Alice
    participant Server
    participant Bob

    Alice->>Server: create_room()
    Server-->>Alice: room_id: "XJ3KL9"

    Alice->>Server: join_room("XJ3KL9", role="sender")
    Server->>Alice: assigned peer_id "A"

    Bob->>Server: join_room("XJ3KL9", role="receiver")
    Server->>Bob: assigned peer_id "B"

    Server-->>Alice: signal {"type":"peer_ready","id":"B"}
    Server-->>Bob: signal {"type":"peer_ready","id":"A"}

    Alice->>Server: signal (SDP offer)
    Server-->>Bob: signal (SDP offer)

    Bob->>Server: signal (SDP answer)
    Server-->>Alice: signal (SDP answer)

    loop ICE candidates
        Alice->>Server: signal (candidate)
        Server-->>Bob: signal (candidate)
        Bob->>Server: signal (candidate)
        Server-->>Alice: signal (candidate)
    end

    Note right of Server: Direct P2P DataChannel open

    Alice->>Bob: start_transfer(file)
    Bob->>Bob: receives file chunks
    Bob->>Bob: assemble file on disk
```

```dot
digraph G {
  A -> B;
  B -> C;
  B -> D;
}
```

```wavedrom
{ "signal": [
  { "name": "clk", "wave": "p....." },
  { "name": "data", "wave": "x345x.", "data": ["head", "body", "tail"] }
]}
```