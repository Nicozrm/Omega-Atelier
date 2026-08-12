Klar — hier als ein einziger Copy-Paste-Block für deine README.md:

# OMEGA Atelier
<p align="center">
  <img src="./docs/assets/omega-atelier-logo.svg" alt="OMEGA Atelier" width="220">
</p>
<p align="center">
  <strong>Design. Visualize. Connect. Control.</strong>
</p>
<p align="center">
  The intelligent workspace for designing, visualizing and connecting Smart Homes.
</p>
<p align="center">
  <img src="./docs/assets/omega-atelier-showcase.gif"
       alt="OMEGA Atelier product showcase"
       width="960">
</p>
<p align="center">
  <a href="#overview">Overview</a> ·
  <a href="#core-experience">Experience</a> ·
  <a href="#digital-twin">Digital Twin</a> ·
  <a href="#smart-home-connectivity">Connectivity</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#development">Development</a>
</p>
<p align="center">
  <img src="https://img.shields.io/badge/React-TypeScript-blue" alt="React TypeScript">
  <img src="https://img.shields.io/badge/Vite-Frontend-purple" alt="Vite">
  <img src="https://img.shields.io/badge/3D-Visualization-black" alt="3D">
  <img src="https://img.shields.io/badge/Supabase-Cloud-green" alt="Supabase">
  <img src="https://img.shields.io/badge/PWA-Ready-orange" alt="PWA">
</p>
---
## Overview
OMEGA Atelier is a cloud-based Smart Home planning and visualization workspace.
It combines spatial planning, 3D visualization, furniture and device placement, Smart Home ecosystems and a live Digital Twin into one coherent environment.
Instead of designing a home in one application, visualizing it somewhere else and managing connected devices through multiple manufacturer apps, OMEGA Atelier provides a single model of the space and everything inside it.
The result is a workspace where the physical environment, its visual representation and its connected devices can exist as one system.
> **One home. One workspace. One Digital Twin.**
---
## Why OMEGA Atelier?
Smart Homes are usually fragmented.
A floor plan lives in one application.
Furniture is planned somewhere else.
3D visualization is handled by another tool.
Smart Home devices are distributed across manufacturer ecosystems.
Automation platforms maintain yet another representation of the home.
OMEGA Atelier approaches the problem differently.
The home itself becomes the central model.
Rooms, walls, furniture, devices, capabilities, states and connected ecosystems are represented as parts of the same project.
This makes the application useful not only as a planning tool, but as a foundation for operating and understanding a Smart Home.
---
# The OMEGA Experience
## Design
Create and edit homes directly on an interactive canvas.
Build rooms, floors, walls and spatial structures while keeping the plan visually understandable and precise.
Projects can contain multiple floors and complex room layouts.
The editor is designed around the idea that planning should feel closer to working with a digital model than filling out a traditional form.
---
## Furnish
Place furniture and objects into the environment.
Furniture, architectural elements and Smart Home devices can coexist inside the same spatial representation.
The result is not simply a technical floor plan.
It becomes a representation of the actual environment.
---
## Visualize
Move from a 2D floor plan into a 3D representation of the designed space.
The 3D layer is intended to provide immediate spatial feedback:
- room proportions
- furniture placement
- architectural elements
- doors and windows
- lighting
- materials and textures
- connected devices
- environmental state
The goal is simple:
> What you design should be understandable before it is built.
---
## Connect
OMEGA Atelier is designed around a vendor-neutral connector architecture.
Instead of teaching the core application about individual manufacturers, external ecosystems are translated into a common device model.
This allows different ecosystems to coexist inside the same Digital Twin.
Examples include:
- Home Assistant
- MQTT
- Tuya / Smart Life
- Govee
- SwitchBot
- ONVIF
- and additional ecosystem adapters
Simulated ecosystems can also be used for demonstrations and development without requiring physical hardware.
---
# The Digital Twin
The Digital Twin is the architectural center of OMEGA Atelier.
It represents the current state of the home independently from the vendor APIs that provide the underlying data.
A device is represented through normalized concepts such as:
- device identity
- room assignment
- capabilities
- state
- telemetry
- energy information
- health
- connector ownership
For example, a light does not become an "X-brand light" inside the core system.
It becomes a device exposing capabilities such as:
```text
OnOff
Brightness
Color
ColorTemperature

A lock can expose:

Lock

A blind can expose:

Position

A sensor can expose:

Temperature
Humidity
Motion
Energy

This abstraction is what allows the rest of OMEGA Atelier to remain vendor-agnostic.

⸻

One Twin. Multiple Ecosystems.

Multiple connectors can feed the same Digital Twin simultaneously.

For example:

Home Assistant ─────┐
                    │
Tuya Cloud ─────────┤
                    │
Govee ──────────────┤
                    ├──> Digital Twin
SwitchBot ──────────┤
                    │
ONVIF ──────────────┤
                    │
MQTT ───────────────┘

The UI does not need to know how a particular manufacturer communicates.

It only consumes the normalized twin.

This separation makes the architecture extensible without turning the application core into a collection of vendor-specific integrations.

⸻

Live Device State

The Digital Twin is not only a static project representation.

Connected devices can report live state.

Changes are merged into the existing device model while preserving capabilities that were not updated.

This allows the same state to be consumed by:

* the device interface
* the floor plan
* the 3D visualization
* scenes
* energy analysis
* automation logic
* AI features
* future integrations

The principle is:

One live state. Many consumers.

⸻

Physical Control

Where a connector supports write access, commands can travel from the OMEGA interface back to the physical device.

For example:

OMEGA UI
   ↓
Device Command
   ↓
Digital Twin Runtime
   ↓
Owning Connector
   ↓
Vendor / Local Transport
   ↓
Physical Device

The application therefore does not need to expose vendor-specific command formats to the rest of the system.

A neutral command such as:

Brightness → 65%

can be translated by the corresponding connector into the protocol required by the target ecosystem.

⸻

Smart Home Connectivity

OMEGA Atelier separates connectivity from the application core.

Each connector implements a small, consistent contract:

connect()
discover()
synchronize()
publish()
subscribe()
health()

This means new ecosystems can be integrated without changing the Digital Twin itself.

The architecture supports both simulated and live transports.

Live integrations

Live integrations can communicate with real services and devices where supported.

Examples include:

* Home Assistant
* Tuya Cloud
* Govee Cloud
* SwitchBot Cloud
* ONVIF cameras

Development and simulation

Simulated connectors make it possible to test the application without physical devices.

This is useful for:

* UI development
* demonstrations
* automated tests
* connector development
* scene testing
* Digital Twin validation

⸻

Scenes

OMEGA Atelier can operate multiple devices as a coordinated system.

Instead of controlling every device individually, scenes can translate a desired environment into a batch of normalized commands.

Examples include:

* Morning
* Day
* Golden Hour
* Evening
* Night
* Cinema
* Coffee
* Away
* Party
* Automatic

A scene can therefore affect devices from multiple connectors simultaneously.

Scene
  ↓
Command Batch
  ↓
Digital Twin
  ├── Home Assistant
  ├── Govee
  ├── SwitchBot
  ├── Tuya
  └── Other connectors

The scene logic remains independent from individual manufacturers.

⸻

Spatial Device Binding

Devices can be assigned to rooms inside the project.

This creates the connection between the Smart Home model and the physical layout.

For example:

Living Room
 ├── Ceiling Light
 ├── TV
 ├── Smart Speaker
 ├── Blind
 └── Temperature Sensor
Bedroom
 ├── Bedside Light
 ├── Blind
 └── Temperature Sensor

The same room relationship can then be used by the floor plan, device view, scenes and future automation systems.

⸻

2D + 3D

OMEGA Atelier treats the floor plan and 3D environment as two views of the same underlying project.

The 2D representation provides precision and efficient editing.

The 3D representation provides spatial understanding.

The long-term goal is not to maintain two separate worlds.

It is to make both views consume the same project model.

                    Project Model
                         │
              ┌──────────┴──────────┐
              │                     │
          2D Floor Plan          3D View
              │                     │
              └──────────┬──────────┘
                         │
                   Digital Twin
                         │
                 Connected Devices

This architecture makes visual changes and live device state part of the same environment.

⸻

Real-Time Collaboration

OMEGA Atelier is designed as a cloud-based workspace rather than a purely local editor.

Projects can be persisted through Supabase and can support shared project state and collaboration.

The application architecture is designed around:

* project ownership
* access control
* collaboration
* cloud persistence
* synchronized project state
* version-aware data

The objective is to make a Smart Home project something that can be worked on as a shared digital asset rather than a file sitting on a single machine.

⸻

Cloud Architecture

The application uses Supabase as the cloud layer for project-related services.

The frontend remains responsible for the interactive application experience while the cloud layer provides persistent project infrastructure.

A simplified model:

                    OMEGA Atelier
                         │
             ┌───────────┴───────────┐
             │                       │
         Frontend                 Supabase
             │                       │
     ┌───────┼────────┐        ┌─────┼─────┐
     │       │        │        │     │     │
   Editor   3D      Twin    Database Auth  Storage

The architecture deliberately keeps vendor-specific Smart Home logic outside the core project model.

⸻

Security Model

Credentials for external integrations are treated separately from the project model.

The application distinguishes between:

* project data
* device metadata
* connector configuration
* authentication credentials
* transport-specific secrets

Where a credential can safely remain local, the UI keeps it local.

For integrations that require a server-side relay or cloud function, the browser does not need direct access to the vendor endpoint.

This is particularly important for APIs that cannot safely or reliably be called directly from a browser because of CORS or secret-handling requirements.

⸻

Vendor-Neutral Architecture

One of the core design principles of OMEGA Atelier is:

The core should not know the vendor.

The application core understands:

Device
Capability
Command
Room
State
Telemetry
Health
Connector

It should not need to understand:

Govee API
SwitchBot API
Tuya API
MQTT payloads
ONVIF SOAP

Those concerns belong to the connector layer.

This creates a clean boundary:

Vendor APIs
     ↓
Connectors
     ↓
Normalized Devices
     ↓
Digital Twin
     ↓
OMEGA Atelier

⸻

Capability-Based Devices

OMEGA Atelier uses capabilities rather than hard-coded device types as the primary abstraction.

A device can expose multiple capabilities.

For example:

Smart Light
 ├── OnOff
 ├── Brightness
 ├── Color
 └── ColorTemperature

A smart blind:

Blind
 └── Position

A smart lock:

Lock
 └── Lock

A sensor:

Sensor
 ├── Temperature
 ├── Humidity
 └── Motion

This makes device support extensible and avoids creating a separate implementation for every physical product.

⸻

Responsive Product Experience

OMEGA Atelier is designed as a modern, mobile-first web application.

The interface adapts to different screen sizes while maintaining the same project model and interaction concepts.

The goal is to make the workspace usable across:

* smartphones
* tablets
* laptops
* desktop displays

The application can also operate as a Progressive Web App.

⸻

Product Interface

The interface follows a restrained, dark “quiet luxury” visual language.

The design focuses on:

* strong spatial hierarchy
* minimal visual noise
* restrained color
* responsive controls
* subtle motion
* clear state feedback
* contextual information

Animations are used to communicate state and interaction rather than simply decorate the interface.

Examples include:

* device state transitions
* command feedback
* connection states
* scene activation
* panel transitions
* 2D/3D transitions
* live Digital Twin updates

⸻

Motion & Animation

Motion is part of the product language.

The objective is not to make the interface constantly move.

Instead, animation should answer a question:

What just changed?

For example:

Device command
      ↓
Soft interaction feedback
      ↓
Pending state
      ↓
Physical confirmation
      ↓
Calm state transition

This makes asynchronous Smart Home operations easier to understand.

The same principle applies to the 3D environment, where transitions can communicate changes in spatial state without overwhelming the user.

⸻

Product Showcase

The repository can include lightweight animated product demonstrations.

Recommended structure:

docs/
└── assets/
    ├── omega-atelier-logo.svg
    ├── omega-atelier-showcase.gif
    ├── floorplan-demo.gif
    ├── digital-twin-demo.gif
    └── 3d-demo.gif

The README can then present the product through short visual loops instead of relying entirely on screenshots.

For example:

<p align="center">
  <img
    src="./docs/assets/digital-twin-demo.gif"
    alt="OMEGA Atelier Digital Twin"
    width="900"
  >
</p>

Short, high-quality loops are preferred over long recordings.

⸻

Project Structure

The repository is organized around the separation between product UI, domain logic, connectors and cloud infrastructure.

.
├── src/
│   ├── domain/
│   │   ├── capabilities
│   │   ├── connector
│   │   ├── device
│   │   └── runtime
│   │
│   ├── connectors/
│   │   ├── homeAssistant/
│   │   ├── mqtt/
│   │   ├── tuya/
│   │   ├── onvif/
│   │   └── brands/
│   │
│   ├── twin/
│   │   ├── twinManager
│   │   ├── binding
│   │   └── scenes
│   │
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   └── store/
│
├── public/
├── supabase/
├── docs/
└── README.md

The exact structure may evolve, but the architectural boundaries are intentional.

⸻

Architecture

At a high level:

                         OMEGA Atelier
                              │
                 ┌────────────┴────────────┐
                 │                         │
             Application                Project
                 │                       State
                 │                         │
          ┌──────┴──────┐                  │
          │             │                  │
       2D Editor       3D View              │
          │             │                  │
          └──────┬──────┘                  │
                 │                         │
                 └──────────┬──────────────┘
                            │
                     Digital Twin
                            │
                     Twin Runtime
                            │
                 ┌──────────┼──────────┐
                 │          │          │
             Connector  Connector  Connector
                 │          │          │
                HA        Tuya      SwitchBot
                                      │
                                    Govee
                                      │
                                    ONVIF
                                      │
                                    MQTT

The Digital Twin is the boundary between the application and external device ecosystems.

⸻

Runtime

The DigitalTwinRuntime maintains the current live device model.

Its responsibilities are deliberately narrow:

* register connectors
* adopt discovered devices
* apply device updates
* remove connectors
* route commands
* expose device queries
* publish state changes

It does not contain vendor-specific logic.

A connector owns the communication with an external ecosystem.

The runtime owns the unified model.

⸻

Twin Manager

The application-level TwinManager orchestrates the runtime and provides the UI with a unified view.

It tracks:

* active connectors
* connector health
* devices
* room bindings
* command state
* active scenes

This allows the UI to interact with the Smart Home as one system without directly managing every transport.

⸻

Connector Contract

Connectors expose a common abstraction.

Conceptually:

interface Connector {
  connect(): Promise<void>
  disconnect(): Promise<void>
  discover(): Promise<Device[]>
  synchronize(): Promise<Device[]>
  publish(command: DeviceCommand): Promise<void>
  subscribe(onUpdate: (update: DeviceUpdate) => void): Unsubscribe
  health(): ConnectorHealth
}

A brand or ecosystem implementation only needs to translate between its own protocol and the OMEGA domain model.

⸻

Technology

OMEGA Atelier is built using modern web technologies.

Frontend

* React
* TypeScript
* Vite
* Tailwind-style utility classes
* Lucide icons

Spatial / 3D

* Canvas-based planning
* 3D visualization
* Interactive spatial models
* Real-time device state integration

Cloud

* Supabase
* Database persistence
* Authentication
* Cloud project infrastructure
* Collaboration support

Application Architecture

* Digital Twin runtime
* Connector abstraction
* Capability-based device model
* Offline-aware state handling
* PWA support

⸻

Development

Requirements

A current Node.js installation is recommended.

Install dependencies:

npm install

Run the development server:

npm run dev

Create a production build:

npm run build

Run tests:

npm test

Run linting:

npm run lint

⸻

Environment Configuration

Environment-specific configuration should be provided through the project’s environment configuration.

Secrets should never be committed to the repository.

For Smart Home integrations, credentials should be handled according to the security requirements of the individual ecosystem.

Some integrations may require a server-side relay or local bridge instead of direct browser communication.

See:

docs/

for connector-specific setup information.

⸻

Connecting Smart Home Ecosystems

OMEGA Atelier supports two fundamentally different connector categories.

Simulated ecosystems

These are available immediately and provide realistic device fleets for development and demonstration.

No credentials or physical hardware are required.

Live ecosystems

Live connectors communicate with real services or local bridges.

Examples:

Home Assistant
Tuya Cloud
Govee Cloud
SwitchBot Cloud
ONVIF

The UI exposes connection state and health so that a failed transport does not silently appear as a functional device.

⸻

Error Handling

Smart Home systems are inherently asynchronous.

A command may take time to reach the physical device.

A cloud service may be temporarily unavailable.

A device may not respond.

OMEGA Atelier therefore distinguishes between:

pending
confirmed
failed

The interface can represent a command as pending while waiting for confirmation rather than immediately assuming that the physical device changed.

This prevents the UI from pretending that a cloud request and a physical state change are the same thing.

⸻

Offline-First Philosophy

The application is designed so that the workspace remains useful even when external services are unavailable.

The local application state and the live cloud state are treated as separate concerns.

This is particularly important for a planning application:

You should still be able to design the home even when the Smart Home is offline.

Live integrations become an additional layer rather than a hard dependency for the core planning experience.

⸻

Extensibility

OMEGA Atelier is designed to grow beyond the currently supported ecosystems.

A new integration should ideally require:

1. A connector implementation.
2. Vendor-specific authentication/transport.
3. Mapping vendor devices to OMEGA capabilities.
4. Mapping OMEGA commands back to the vendor API.

The Digital Twin, floor plan, 3D layer and higher-level application logic should not need to know which vendor was added.

This is the central extensibility mechanism of the platform.

⸻

Product Roadmap

The long-term direction of OMEGA Atelier is to evolve from a Smart Home planner into a complete spatial operating environment.

Potential areas include:

Spatial Intelligence

* Improved 3D visualization
* Richer materials and lighting
* Architectural recognition
* Intelligent object placement
* Spatial AI assistance

Smart Home Intelligence

* Advanced scenes
* Automation recommendations
* Energy analysis
* Anomaly detection
* Device health monitoring

Digital Twin

* Richer telemetry
* Historical state
* Environmental modeling
* Spatial device relationships
* Predictive state

Collaboration

* Shared workspaces
* Project permissions
* Real-time collaboration
* Version history
* Team workflows

AI

AI can operate on the normalized project and Digital Twin rather than directly against individual vendor APIs.

This opens the door to higher-level interactions such as:

“Make the living room comfortable for movie night.”

The system can reason over the room, available devices, capabilities and current state before producing the required commands.

⸻

Design Philosophy

OMEGA Atelier is built around a few simple principles.

Digital Twin First

The home should have one canonical live representation.

Connector First

External ecosystems should plug into the platform rather than define it.

Capability First

Devices should be described by what they can do, not only by what they are called.

Offline First

The planning experience should not disappear because a cloud service is unavailable.

Vendor Neutral

The core should never depend on a specific manufacturer.

Visual First

Spatial information should be understandable visually whenever possible.

Calm Technology

The interface should communicate complexity without becoming complex itself.

⸻

What OMEGA Atelier Is

OMEGA Atelier is not simply:

* a floor-plan editor
* a 3D viewer
* a Smart Home dashboard
* a device control panel
* an automation builder

It is the layer connecting these concepts.

The central idea is a shared digital representation of the physical environment.

                  HOME
                   │
        ┌──────────┼──────────┐
        │          │          │
      SPACE     OBJECTS    DEVICES
        │          │          │
        └──────────┼──────────┘
                   │
             DIGITAL TWIN
                   │
        ┌──────────┼──────────┐
        │          │          │
      DESIGN    VISUALIZE   CONTROL
        │          │          │
        └──────────┼──────────┘
                   │
              INTELLIGENCE

That is the foundation of OMEGA Atelier.

⸻

Getting Started

Launch the application and create a project.

From there you can:

1. Create your floor plan.
2. Add rooms and architectural elements.
3. Place furniture and objects.
4. Explore the 3D representation.
5. Connect Smart Home ecosystems.
6. Discover devices.
7. Assign devices to rooms.
8. Control compatible devices.
9. Create scenes.
10. Explore the live Digital Twin.

The same project becomes the spatial and connected representation of the home.

⸻

Repository

The repository contains the complete OMEGA Atelier application together with documentation, cloud infrastructure and supporting resources.

src/       Application
public/    Static assets
supabase/  Cloud infrastructure
docs/      Documentation and setup guides

Historical documentation and development notes are maintained separately where appropriate.

⸻

Status

OMEGA Atelier is under active development.

The platform is being developed toward a production-ready Smart Home workspace with:

* Interactive spatial planning
* Multi-floor projects
* 3D visualization
* Digital Twin infrastructure
* Smart Home connectors
* Live device state
* Physical device control
* Scenes
* Cloud persistence
* Collaboration
* PWA support

The architecture is intentionally designed so that new capabilities can be added without rebuilding the core around individual vendors.

⸻

License

See the repository license for details.

⸻

<p align="center">
  <strong>OMEGA Atelier</strong>
  <br>
  <sub>Design the space. Connect the home. Understand the system.</sub>
</p>
```
 
