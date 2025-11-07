// --- Variáveis Globais ---

const defaultLatLng = [-30.026649252453343, -51.212062653448214]; // Porto Alegre
let map;
let userLocation;
const searchRadius = 100000; // 100 km

// Camadas
const busLayer = L.layerGroup();
const trainLayer = L.layerGroup();
const metroLayer = L.layerGroup();
const bikeLayer = L.layerGroup(); // 🚲 novas estações Bike Itaú
const unknownLayer = L.layerGroup();

// Cluster principal
const clusterGroup = L.markerClusterGroup();

// --- Inicialização ---
function initMap() {
    map = L.map('map').setView(defaultLatLng, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Adiciona clusters
    map.addLayer(clusterGroup);
    clusterGroup.addLayer(busLayer);
    clusterGroup.addLayer(trainLayer);
    clusterGroup.addLayer(metroLayer);
    clusterGroup.addLayer(bikeLayer);
    clusterGroup.addLayer(unknownLayer);

    createCustomControls();
    locateUser();
}

// --- Localização do usuário ---
function locateUser() {
    map.locate({ setView: true, maxZoom: 13, watch: false });

    map.on('locationfound', (e) => {
        userLocation = e.latlng;
        L.marker(userLocation)
            .bindPopup("📍 Você está aqui!")
            .addTo(map)
            .openPopup();
        fetchStops(userLocation, searchRadius);
        fetchBikeStations(); // 🚲 busca também estações Bike Itaú
    });

    map.on('locationerror', () => {
        alert("Localização negada. Usando Porto Alegre.");
        userLocation = L.latLng(defaultLatLng[0], defaultLatLng[1]);
        fetchStops(userLocation, searchRadius);
        fetchBikeStations();
    });
}

// --- Busca de transporte público (Overpass API) ---
async function fetchStops(latlng, radius) {
    showLoading(true);
    const { lat, lng } = latlng;

    // Overpass Query real e válida
    const query = `
        [out:json][timeout:60];
        (
          node[highway=bus_stop](around:${radius},${lat},${lng});
          node[railway=station](around:${radius},${lat},${lng});
          node[public_transport=station][subway=yes](around:${radius},${lat},${lng});
          node[railway=subway_entrance](around:${radius},${lat},${lng});
        );
        out;
    `;

    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        processStops(data);
    } catch (err) {
        console.error("Erro Overpass:", err);
        alert("Erro ao buscar dados da Overpass API.");
    } finally {
        showLoading(false);
    }
}

// --- 🚲 Busca estações Bike Itaú (BikePOA) ---
async function fetchBikeStations() {
    try {
        // API pública não documentada, mas disponível via feed usado por apps terceiros
        const url = "https://gbfs.bikeitau.com/api/v1/stations";
        const response = await fetch(url);
        const data = await response.json();
        processBikeStations(data);
    } catch (error) {
        console.warn("Bike Itaú feed não acessível:", error);
    }
}

// --- Processamento Overpass ---
function processStops(data) {
    busLayer.clearLayers();
    trainLayer.clearLayers();
    metroLayer.clearLayers();
    unknownLayer.clearLayers();

    if (!data.elements?.length) {
        alert("Nenhuma parada encontrada.");
        return;
    }

    data.elements.forEach(el => {
        if (!el.lat || !el.lon) return;
        const stopLatLng = L.latLng(el.lat, el.lon);
        const tags = el.tags || {};
        const typeData = determineStopType(tags);
        const distanceKm = userLocation.distanceTo(stopLatLng) / 1000;
        const size = calculateMarkerSize(distanceKm);

        const icon = L.divIcon({
            className: `stop-marker ${typeData.cssClass}`,
            html: `<b style="font-size:${size * 0.4}px">${typeData.label}</b>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2]
        });

        const marker = L.marker(stopLatLng, { icon });
        const markerName = tags.name || `Parada de ${typeData.name}`;
        marker.bindTooltip(`<b>${markerName}</b><br>${typeData.name}<br>${distanceKm.toFixed(1)} km`);

        switch (typeData.type) {
            case 'bus': busLayer.addLayer(marker); break;
            case 'train': trainLayer.addLayer(marker); break;
            case 'metro': metroLayer.addLayer(marker); break;
            default: unknownLayer.addLayer(marker);
        }
    });

    map.fitBounds(clusterGroup.getBounds());
}

// --- 🚲 Processamento Bike Itaú ---
function processBikeStations(data) {
    bikeLayer.clearLayers();

    if (!data?.stations?.length) return;

    data.stations.forEach(st => {
        const lat = st.latitude;
        const lon = st.longitude;
        const name = st.name || "Estação Bike Itaú";
        const bikes = st.available_bikes ?? "?";
        const slots = st.available_docks ?? "?";

        const icon = L.divIcon({
            className: 'stop-marker bike',
            html: `<b style="font-size:12px">🚲</b>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        const marker = L.marker([lat, lon], { icon });
        marker.bindTooltip(`<b>${name}</b><br>Bikes: ${bikes}<br>Vagas: ${slots}`);
        bikeLayer.addLayer(marker);
    });
}

// --- Auxiliares ---
function determineStopType(tags) {
    if (tags.railway === 'subway_entrance' || tags.subway === 'yes')
        return { type: 'metro', name: 'Metrô', label: 'M', cssClass: 'metro' };
    if (tags.railway === 'station')
        return { type: 'train', name: 'Trem', label: 'T', cssClass: 'train' };
    if (tags.highway === 'bus_stop')
        return { type: 'bus', name: 'Ônibus', label: 'Ô', cssClass: 'bus' };
    return { type: 'unknown', name: 'Estação', label: '?', cssClass: 'unknown' };
}

function calculateMarkerSize(distanceKm) {
    const min = 10, max = 30;
    return Math.max(min, Math.min(max, max - (distanceKm / 10)));
}

function showLoading(show) {
    const el = document.getElementById('loading');
    if (el) el.classList.toggle('hidden', !show);
}

// --- Controles ---
function createCustomControls() {
    // Centralizar
    L.Control.Center = L.Control.extend({
        onAdd: function() {
            const div = L.DomUtil.create('div', 'leaflet-control-custom leaflet-control-center');
            div.innerHTML = '<button title="Centralizar em mim">📍</button>';
            div.onclick = () => locateUser();
            return div;
        }
    });
    new L.Control.Center({ position: 'topright' }).addTo(map);

    // Filtro
    L.Control.Filter = L.Control.extend({
        onAdd: function() {
            const div = L.DomUtil.create('div', 'leaflet-control-custom leaflet-control-filter');
            div.innerHTML = `
                <label>Filtrar:</label>
                <select id="transport-filter">
                    <option value="all">Todos</option>
                    <option value="bus">Ônibus</option>
                    <option value="train">Trem</option>
                    <option value="metro">Metrô</option>
                    <option value="bike">Bicicletas</option>
                </select>`;
            L.DomEvent.disableClickPropagation(div);
            div.onchange = e => filterLayers(e.target.value);
            return div;
        }
    });
    new L.Control.Filter({ position: 'topright' }).addTo(map);
}

function filterLayers(filter) {
    clusterGroup.clearLayers();
    if (filter === 'all') clusterGroup.addLayer(busLayer)
        .addLayer(trainLayer).addLayer(metroLayer)
        .addLayer(bikeLayer).addLayer(unknownLayer);
    else if (filter === 'bus') clusterGroup.addLayer(busLayer);
    else if (filter === 'train') clusterGroup.addLayer(trainLayer);
    else if (filter === 'metro') clusterGroup.addLayer(metroLayer);
    else if (filter === 'bike') clusterGroup.addLayer(bikeLayer);
}

// --- Inicializa ---
document.addEventListener('DOMContentLoaded', initMap);
