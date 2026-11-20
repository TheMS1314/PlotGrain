# Plotgrain

Browser-based early feasibility screening for Bangkok’s R.8 zone. The calculation worker uses metric geometry and independently checks the concepts it generates. The site view uses saved OpenFreeMap streets and an extract of Overture building footprints in Bang Son. It draws both plan and 3D views with Canvas 2D so embedding environments can run it without WebGL or network tile requests.

Run `npm ci`, then `npm test` and `npm run dev`. Run `npm run build` to build the Cloudflare Worker release.

## Product page and workspace

Guests can browse the landing page and switch between the envelope, Garden Court, and Compact Stack in the interactive Bang Son preview. **Open workspace** prompts guests to sign in and then opens the Map-first layout at `/study/`. The preview also links to specific workspace views. In the workspace, **Compare concepts** shows both concepts at the same scale and angle with their measurements and modeled checks. Choose **Overlay** and adjust **Reveal balance** to inspect where their footprints and heights differ on the same plot.

## Design review

Open `/design-review/` to compare layouts. **Map-first** gives the map most of the width and opens the overlay by default. **Review-first** leads with the generated massing models and opens the side-by-side comparison by default. Both directions use the same study inputs and calculations. Open **Compare concepts** and choose **Print sheet** to print or save a PDF with the matched-scale models, measurements, checks and rule sources. The previous release is tagged `plotgrain-v20` and its hosted build is archived as version 20.

## Demo evidence

- The Bang Son example has a **1,043.8 m² schematic parcel** with a **5 m assumed right-of-way** and a **2.5 m assumed centerline offset**. The streets and building footprints are mapped. Surrounding heights are estimated.
- The **6,262.6 m² base FAR budget** comes from the 6:1 ratio. At the **22.9 m** / **seven equal floors** inspection setting, the modeled floor-plate cap is **578.4 m² per floor**, controlled by the geometric clearances.
- **Garden Court (940 m² gross)** and **Compact Stack (970 m² gross)** are examples generated from preset size targets. Their pass labels cover the modeled checks. Official zoning, public-road frontage and access, and permit requirements need independent review.
- **Study tools → Load no-fit example** opens a schematic 3.5 × 9 m parcel at the same location. Its 31.5 m² outline remains measurable and the geometry engine returns a 0 m² envelope through every modeled height. Open it directly at `/study/?example=narrow`.

## Frontend design harness

Use the [Product interface skill](.agents/skills/product-interface/SKILL.md) and [DESIGN.md](DESIGN.md) when changing either page. The design harness checks the production bundle in Chromium at 1440, 980, 390, and 320 CSS pixels. It checks the landing-to-study links, keyboard focus, automated WCAG rules, root asset budgets, and the GeoJSON download.

Run `npx playwright install chromium` on a new development machine, then `npm run lint:design` and `npm run test:design`. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an existing Chromium binary. The harness serves the package's compiled files inside the browser context using an isolated test origin. It needs no preview server, account, or third-party network access. Screenshots, the JSON report, and traces for failed checks appear in `artifacts/design/`.

## Customer workspaces

Open **Profile** from the landing page to see your verified ChatGPT email, save a Plotgrain display name, and reopen recently saved studies you can access. Plotgrain stores the display name against your stable hosted account ID. The same account can open these records from another browser or device.

Open **Customer workspaces** at `/projects/` after signing in. Create a customer, then its projects, studies, and discussions. Projects, version history, and discussions have direct links. Open a link in a new tab or share it with someone who has access to the customer. To import your current parcel workspace into a new study, open the dashboard from the same study tab and select **Start with this tab’s parcel workspace**. In a saved study, use **Study tools → Save project version** to record a named snapshot. Opening a historical version gives a preview. **Restore** records a new version and preserves later history.

Owners can rename customers. Owners and editors can rename projects, studies, and discussions using the action beside the selected record's heading. Renaming preserves the record's links, memberships, and study versions. If someone else changed the name while the dialog was open, review the latest record before saving again.

Each customer has an owner. Owners manage invitations and membership. Editors can create and update project records, while viewers can open them. An email can have one active invitation per customer. Invitations expire after seven days, work once, and must match the email from the hosted account. Accepting an invitation or removing access expires any other outstanding links for that email and customer. The dashboard creates a link for the owner to share. Site access and customer membership are both required.

Plotgrain runs on ChatGPT Sites, with a Cloudflare Worker and a managed D1 database. The Worker keys memberships to the verified account ID and checks them on each operation. Visitors without authenticated identity have no customer records. ChatGPT Sites handles the credentials and session for the hosted sign-in option. Plotgrain stores a SHA-256 digest of each randomly generated invitation token. Study snapshots preserve parcel data, road inputs, survey records, and inspection settings. Reload uploaded building context after opening a saved study.

The build embeds the existing frontend asset bundle in the Worker and packages the schema migrations from `drizzle/`. Apply the migrations before serving customer storage or activating password sign-in. `/healthz` reports whether the storage schema is available. Unit and browser tests use SQLite and test-only site identities to exercise authorization, version conflicts, and restore behavior.

### Email and password sign-in

`/sign-in/` provides signup, confirmation and strength feedback, email verification, password recovery, and sign-in. Better Auth manages password hashes and revocable secure session cookies in D1. Password identities are separate from hosted ChatGPT identities, even when they use the same email. Access from an existing workspace is granted through that workspace's membership.

Email and password signup activates with the database, the exact HTTPS `PLOTGRAIN_AUTH_ORIGIN`, and a `PLOTGRAIN_AUTH_SECRET` generated from at least 32 random bytes. Without an email sender, signup signs the new member in immediately. These accounts can create and reopen their own work. Their email is marked unverified, and the API blocks accepting customer invitations until email ownership has been verified. Existing ChatGPT records remain scoped to their original identity.

Configuring a verified `PLOTGRAIN_AUTH_FROM` sender and `RESEND_API_KEY` activates email verification and password recovery. The forms then require email verification before password sign-in. Configure all values through the hosting provider's secret store and test real delivery. Until an email sender is configured, password recovery and email verification are unavailable and the UI says so during signup. An owner-only ChatGPT Site requires the hosted identity before any page or API is reachable. Standalone password sign-in requires public Site access. The Worker relies on ChatGPT Sites dispatch to supply trusted identity headers.

### Release and recovery

1. Run `npm test`, `npm run lint:design`, and `npm run test:design` against the release commit. Browser tests run against the compiled Worker and its content security policy.
2. Record the current Site version for rollback. Confirm `/healthz` and the D1 schema on the candidate deployment. Preserve the existing database during an application rollback. Before rolling back a public site to a release older than v29, restore owner-only access because those releases relied on the hosting gate for workspace pages.
   After publishing, run `node scripts/smoke-public.mjs https://your-plotgrain-host` to verify guest access, protected workspace routes and APIs, hosted sign-in, and D1 health against the live origin. Add `--expect-password-signup` when releasing email sign-in.
3. Before public onboarding, use real inboxes and fresh browser sessions to verify signup, verification, recovery, sign-out, and a cross-customer access denial. Test with a direct saved-study link and verify that the same version opens after sign-in. For an invitation, reopen the original link after email verification to claim it.
4. Confirm that the hosting operator can back up D1 and restore it to a separate database. Verify authorization, version history, and recovery against that copy before opening public access. If storage recovery is required during an incident, coordinate write downtime and verify the restored copy before changing the active binding.
5. Check Worker errors and Resend delivery events after launch. The Worker records delivery rejection status and transport failure type without email addresses or verification tokens. Auth mail is limited by source IP and by a keyed digest of the recipient. Remove expired `auth_delivery_limits` rows through the database maintenance workflow when needed.

If a save response is interrupted, retry with the same version name in the open save dialog. The server acknowledges the existing save if it committed before the connection dropped. When a project version changes while another editor is working, saving preserves the editor's open tab. Use **Export my edits** to save the current workspace as GeoJSON, or **Open latest version in a new tab** to compare it with the saved version.

## Study boundaries

The Bang Son example has schematic plot and road dimensions on a real street. Custom plots require an explicit R.8 selection. Confirm legal zoning, applicable overlays, lot boundaries and public right-of-way in official records for a real site. Context buildings use mapped footprints and a uniform estimated height.

The model supports a flat site and one straight road frontage with facade openings. The envelope shows geometric clearance below 23 m in discrete height slices. It does not implement FAR bonuses, corner or dual-frontage treatment, or all local, large-building and permit rules. Concept cards check only the modeled provisions and use schematic planting geometry.

## Sources

- [Bangkok Comprehensive Plan 2013, R.8 clause 15](https://webportal.bangkok.go.th/public/user_files_editor/76/law/tk10.pdf)
- [Ministerial Regulation 55, clauses 33, 41, 44 and 50](https://webportal.bangkok.go.th/public/user_files_editor/95/ITA2566/O4/CI/ci-11.pdf)
- [OpenFreeMap](https://openfreemap.org/) and [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
- [Overture Maps Foundation](https://overturemaps.org/), November 2026 buildings release. The derived local footprint extract at `public/data/buildings.geojson` is available under the [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), with the [upstream attributions](https://docs.overturemaps.org/attribution/).

Use **Draw plot** or import a WGS84 GeoJSON polygon, select a straight frontage, and supply the measured right-of-way width and centerline offset. **Edit** supports dragging vertices and keyboard nudging. **Export study** saves the modeled footprint, envelope sections, concepts, check results, and rule sources as GeoJSON for review in a GIS. Reopening a study restores its building type and any matching frontage and road dimensions as draft inputs. Confirm the zoning again after import.

The main workspace saves completed parcels, site inputs, survey records, and the active view for a refresh in the same browser tab. Calculations run again from the recovered inputs. Use **Parcels → Export comparison** for a portable backup, and reload any custom building context after a refresh. Links to a particular example or concept start a clean demo session. Loading an example from Study tools preserves edited studies in **Parcels**.

Bangkok's building ordinance adds a minimum tied to plot area (clause 52) and a 3 m clearance for openings on third floors and above next to private land (clause 54). The model conservatively applies that 3 m clearance to the full constant floor plate. Road controls combine the supported single-road case from the national regulation with that boundary clearance. Frontage/access conditions, exceptions, parking, and fire provisions remain review items.

[Bangkok Building Control Ordinance, clauses 49–55](https://webportal.bangkok.go.th/public/user_files_editor/76/law/tk24.pdf)

### Existing-site studies

Draw over mapped buildings to assess a replacement scenario. Existing footprint overlap is the union of intersections inside the plot, measured in local metres. The default map outlines affected buildings while retaining the surrounding 3D context. A result indicates mapped overlap and does not establish survey accuracy or permission to clear the site. Building context is limited to the included Bang Son extract, and modeled context heights are approximate. Use Display to set the study name, show edge measurements, switch existing-building layers, and change opacity. Study export retains the mapped overlap geometry and source.

## Team workflow

1. In QGIS or another GIS, export the parcel boundary layer as GeoJSON in WGS84 (EPSG:4326). Use a Polygon per parcel and put a readable label in the feature's `name` property. The workspace holds up to 24 studies including options, with 3–100 vertices per parcel. Use interior rings to exclude land from the boundary. Multipart input opens each Polygon component as its own study, with its own road and zoning review. The import accepts a Polygon or MultiPolygon geometry, a Feature, a FeatureCollection, and this app's study or comparison export.
2. Open **Parcels** to see mapped area and available existing-building overlap. Open a parcel, select the straight road-facing edge, enter the measured public right-of-way width and centerline offset, choose a use, and confirm the R.8 scope. Changing the edge clears the previous road dimensions. Clipped context is reported as partial.
3. Switch between the envelope and building options. Move the height slider to see the buildable plan section and the road cross-section at that height. Use the map layer menu to inspect the original boundary, the setback inset, and the road clip separately. The FAR and open-space figures show the allowable average plate under the equal-floor assumption. Treat the base FAR budget as a zoning ceiling, and review the area actually achieved by the generated concepts and the rules controlling it.
4. Use **Duplicate as option** to test a different use, right-of-way scenario, or frontage without changing the original option. Use **Fit all on map** to locate the compared parcels. The workspace compares each independently.
5. Export the individual study for geometry, rule citations and checks, or the parcel comparison for GIS handoff. A comparison can be reopened: road fields return as draft inputs, zoning requires confirmation, and results are recalculated.

Civil and architectural review still needs a confirmed zoning designation, legal parcel and road records, applicable overlays, and review of conditions outside the included rules. Planning a society or joined development requires a separate assemblage and infrastructure analysis.

### Measurement verification

The reference local-coordinate L-plot still has exactly 1,050 m². The existing demonstration's geographic coordinates have a WGS84 geodesic area of 1,043.767886 m² and a first edge of 29.981484 m, independently computed with GeographicLib. The application uses locally scaled WGS84 metres; the test compares the mapped outline against those reference values. Geometry still reflects the accuracy of the input survey or drawing.

### Export in an embedded panel

A valid outline can be exported while zoning or road inputs are still under review. An outline export includes the parcel, frontage and mapped overlap where available. A completed study adds the envelope, concepts and checks. Both the study and comparison exporters open a preview with a browser download link and a clipboard action. If either permission is blocked by the host, select and copy the visible GeoJSON text into a `.geojson` file.

In either concept view, open **Floor area schedule** to compare per-floor and gross area with the site FAR budget and open-space minimum. The geometry and schedule use the same unrounded inputs.

### Site planning

1. Draw or import each component boundary in **Parcels**. Use Polygon interior rings for excluded areas such as land outside the ownership or development boundary.
2. Mark corridors or common greens **Shared land**. They appear separately on the map and return measured area without a zoning yield. Set alternate versions of a parcel to **Alternative**.
3. Review the union area and any overlap between shared land and parcels. Resolve competing classifications before reporting land allocation. Each proposed building still needs its own parcel and road screen, and a site-wide approval needs verified ownership and shared access, services, and emergency circulation.

### Validation checklist

- Separate stage areas can be inspected for the outline, boundary inset, road setback and road-height plane, with area caps and per-floor schedules alongside. The original independent L-plot fixture has stages of 1,050, 666, 654 and 642 m² at 18 m.
- Automated tests cover disconnected envelope pieces, exclusion rings, invalid boundaries, exact road thresholds, overlapping mapped buildings, distinct residential and office open-space limits, and export/import round trips.
- The UI suppresses zoning results for missing or invalid inputs and gives an empty envelope when the modeled clearances leave no room. Published results are screening outputs. The mapped example uses real roads and footprints with estimated context heights, a schematic lot, and an assumed right-of-way.

### Workspace and review states

The input panel shows the center of the drawn or imported outline and whether the saved Bang Son dataset covers it. Use **Go to coordinates** within the saved map, or import a WGS84 outline for another location. Custom zoning screening uses the selected R.8 district and a user confirmation. Unknown or outside-R.8 studies retain outline measurements and export. The two use profiles are condominium/apartments and office, both under the explicitly modeled size envelope.

The result rail separates geometric slices, quantitative rule checks, and individual concept schedules. Concept thumbnails are projected from the calculated parcel and floor plates. The analysis runs in the browser worker from versioned local rules. The worker returns a valid measured outline if the zoning model cannot run, and a valid envelope if the concept geometry needs review.

When a standard three- or four-storey concept fails, the generator tries lower one- and two-storey options with separate footprint placements and runs every modeled check again. The envelope samples use typical floor-to-floor heights of 3 m for residential and 3.4 m for office to show an illustrative storey count. Concept geometry uses the exact storeys and roof height listed on each card.

### Architectural presentation and 3D handoff

Select a concept, choose **Display → Architectural**, or open **Present** for a larger view on the same page. Use **Orbit** or Shift-drag to change pitch and bearing. Architectural mode draws facade bands, glazing and planting texture from the checked massing and keeps the surrounding map footprints visible. Facades, material colors, and lighting are illustrations. Use **Analysis colors** to return to the rule-focused appearance.

Use **Export 3D** to save the selected concept or the visible final envelope. Concept models contain separate storeys, parcel and planted space. Envelope models retain sampled height slices.

- **GLB** exports a metric mesh with X east, Y up and −Z north. The WGS84 frontage origin is in the node metadata.
- **IFC4** exports metric solids and storeys with preserved courtyard and exclusion rings, a site latitude and longitude, and true north. The solids represent feasibility massing for BIM reference.
- **DXF** exports metric CAD polylines. Floor, roof and envelope outlines retain their elevations. The `_VOID` layers mark internal exclusions.
- **GeoJSON** carries calculation metadata and sources for GIS review.

### Building heights and ground shadows

In **Display**, enter a source reference and load a GeoJSON FeatureCollection of WGS84 building footprints. Each feature must be a Polygon and have a numeric `height_m` property in metres. Add `name` to label a building. Import accepts up to 1,000 footprints and 2 MB. The layer replaces the saved estimated buildings for the current session. Select **Use saved map** to switch back. The app checks the file geometry and labels the heights as supplied by the user.

Open **Sun study**, select a date and Bangkok local time (UTC+7), and choose a concept. The plan displays estimated ground shadows from the concept and, optionally, surrounding buildings. This model uses flat ground and vertical masses. It omits interior daylight, terrain and annual sunlight analysis.

### Coordinate a multi-parcel site

Open **Site plan** to inspect the mapped land union and select a checked concept for each development parcel. Assign corridors and common greens to **Shared land** in **Parcels**. Alternative entries stay out of the site plan. The map highlights overlap between development parcels and conflicts between shared and development land. Totals are withheld for invalid boundaries or overlaps above 0.05 m². Separated blocks are flagged for connectivity review. The displayed floor area sums the independently screened concepts selected in this plan.

Use the review list to record access, fire and egress, utilities, and approval evidence. Changing the site inputs moves recorded reviews back to **Needs action**. Site-plan GeoJSON includes boundaries, selected footprints, conflicts, and review references. The plan screens geometry and organizes review. Permission, access, and infrastructure decisions require the applicable documents and professional review.

### Compare area with a survey record

Open **Survey record** on a parcel to attach a document reference, date, and optional area and tolerance in square metres. Upload a single survey polygon to see its outline on the map and measure how much of each boundary lies outside the other. Choose WGS84 longitude and latitude (EPSG:4326) or WGS84 / UTM 47N easting and northing in metres (EPSG:32647), as declared by the source. If the document uses another datum, convert it before uploading. Changing the study outline marks the record for review until it is saved again. Export the GeoJSON to retain the survey record and the original CRS label. Positional checks use the reference footprint supplied by the user.
