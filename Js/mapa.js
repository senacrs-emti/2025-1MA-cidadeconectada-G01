// Coordenadas padrão (Porto Alegre - Centro) caso a localização do usuário não seja obtida
const defaultLatLng = [-30.0331, -51.2302];

// URL do arquivo GTFS (dados de paradas de ônibus oficiais da prefeitura)
const GTFS_ZIP_URL =
    "https://dadosabertos.poa.br/dataset/1fe9c2c1-9fbe-48ea-841b-61e30597ecd6/resource/b3bce61f-78ee-49eb-be57-6236d82bd5e0/download/arquivo-gtfs.zip";

// URL da API CityBikes (rede Bike Itaú em Porto Alegre)
const CITY_BIKES_URL = "https://api.citybik.es/v2/networks/bikepoa";

// URL do Overpass API (para consultar dados do OpenStreetMap, ex: estações de trem/metro)
const OVERPASS_API = "https://overpass-api.de/api/interpreter";

// Limite máximo de paradas oficiais renderizadas no mapa para evitar peso excessivo
const MAX_STOPS_RENDERED = 800;

// Variável global do mapa Leaflet
let map;

// Localização atual do usuário (inicialmente as coordenadas padrão)
let userLocation = L.latLng(defaultLatLng[0], defaultLatLng[1]);

// Marcador que mostra a posição do usuário
let userMarker;

// Círculo de raio em volta do usuário (raio de busca das paradas)
let radiusCircle;

// Cluster (agrupador) dos marcadores de paradas de ônibus / trem
let stopsCluster;

// Cluster (agrupador) dos marcadores de estações de bicicleta
let bikeCluster;

// Raio de busca em metros (padrão)
let searchRadius = 800;

// Cache dos dados de paradas GTFS para não precisar baixar toda hora
let gtfsStopsCache = null;

// Metadados sobre o GTFS (quantidade de linhas, data de geração, etc.)
let gtfsMetadata = null;

// Cache das estações de bike
let bikeStationsCache = null;

// Timestamp do último fetch das estações de bike (em ms)
let bikeLastFetched = 0;

// Elementos de loading (overlay/carregando) na página
const loadingEl = document.getElementById("loading");
const loadingMessageEl = document.getElementById("loading-message");

// Controle de visibilidade das camadas (paradas e bikes)
const layerVisibility = {
    stops: true, // mostrar camadas de paradas oficiais
    bikes: true, // mostrar camadas de bikes
};

// Função utilitária de debounce:
// atrasa a execução da função 'fn' até que 'delay' ms passem sem novas chamadas
const debounce = (fn, delay = 300) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
    };
};

// Inicializa toda a aplicação
init();

function init() {
    // Cria o mapa Leaflet no elemento com id "map"
    // Desabilita o controle padrão de zoom e centraliza na localização do usuário
    map = L.map("map", { zoomControl: false }).setView(userLocation, 13);

    // Adiciona camada de tiles (satélite) da Esri / ArcGIS
    L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
            attribution:
                "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
            maxZoom: 19,
        },
    ).addTo(map);

    // Adiciona controle de zoom na parte inferior direita do mapa
    L.control.zoom({ position: "bottomright" }).addTo(map);

    // Adiciona botão de centralizar no usuário
    addCenterControl();

    // Adiciona controle de ajuste de raio de busca
    addRadiusControl();

    // Adiciona controle de filtro de camadas (paradas/bikes)
    addFilterControl();

    // Eventos do Leaflet para geolocalização
    map.on("locationfound", handleLocationFound);
    map.on("locationerror", handleLocationError);

    // Pede a localização do usuário pelo navegador
    requestUserLocation();
}

function requestUserLocation() {
    // Solicita a localização do usuário via HTML5 Geolocation através do Leaflet
    map.locate({
        setView: true,          // centraliza o mapa na localização encontrada
        maxZoom: 16,            // zoom máximo ao centralizar
        enableHighAccuracy: true, // pede maior precisão ao navegador
        timeout: 12000,         // tempo máximo de espera (ms)
    });
}

function handleLocationFound(e) {
    // Callback quando a localização é encontrada com sucesso
    userLocation = e.latlng;

    // Atualiza marcador do usuário no mapa e centraliza
    updateUserMarker(userLocation, true);

    // Busca paradas oficiais próximas dentro do raio configurado
    fetchStops(userLocation, searchRadius);

    // Busca estações de bike
    fetchBikeStations();
}

function handleLocationError() {
    // Callback quando ocorre erro ou o usuário nega a localização
    alert("Localização negada. Utilizando Porto Alegre (Centro).");

    // Usa localização padrão
    userLocation = L.latLng(defaultLatLng[0], defaultLatLng[1]);
    map.setView(userLocation, 13);

    // Atualiza marcador do usuário (sem pan animado)
    updateUserMarker(userLocation, false);

    // Carrega paradas e bikes com base na localização padrão
    fetchStops(userLocation, searchRadius);
    fetchBikeStations();
}

function updateUserMarker(latlng, panTo = false) {
    // Se já existe marcador de usuário, apenas atualiza posição
    if (userMarker) {
        userMarker.setLatLng(latlng);
    } else {
        // Cria um novo marcador com ícone customizado (emoji de pino)
        userMarker = L.marker(latlng, {
            icon: L.divIcon({
                className: "stop-marker user",
                html: "📍",
                iconSize: [32, 32],
            }),
        })
            .addTo(map)
            .bindPopup("Você está aqui"); // Popup fixo no marcador do usuário
    }

    // Cria círculo de raio se ainda não existir
    if (!radiusCircle) {
        radiusCircle = L.circle(latlng, {
            radius: searchRadius,    // raio em metros (variável global)
            color: "#0ea5e9",        // cor da borda
            fillColor: "#22d3ee",    // cor de preenchimento
            fillOpacity: 0.08,       // opacidade do preenchimento
        }).addTo(map);
    } else {
        // Se o círculo já existe, apenas move para nova posição
        radiusCircle.setLatLng(latlng);
    }

    // Garante que o raio do círculo está atualizado com a variável global
    radiusCircle.setRadius(searchRadius);

    // Se panTo = true, move o mapa até a posição do usuário
    if (panTo) {
        map.panTo(latlng);
    }
}

function addCenterControl() {
    // Cria um controle personalizado de centralização usando Leaflet.Control.extend
    const CenterControl = L.Control.extend({
        options: { position: "topleft" }, // posição do controle no mapa

        onAdd() {
            // Cria container principal do controle
            const container = L.DomUtil.create(
                "div",
                "leaflet-control-custom leaflet-control-center",
            );

            // Cria botão dentro do container
            const button = L.DomUtil.create("button", "", container);
            button.type = "button";
            button.title = "Voltar para minha posição";
            button.textContent = "◎"; // símbolo de alvo

            // Clique no botão volta a visão para a localização do usuário
            button.addEventListener("click", () => {
                if (userLocation) {
                    // Centraliza com zoom mínimo 15
                    map.setView(userLocation, Math.max(map.getZoom(), 15));
                } else {
                    // Se ainda não existe localização, tenta localizar de novo
                    requestUserLocation();
                }
            });

            // Impede que cliques neste controle se propaguem para o mapa (evita zoom/drag)
            L.DomEvent.disableClickPropagation(container);

            return container;
        },
    });

    // Adiciona o controle ao mapa
    map.addControl(new CenterControl());
}

function addFilterControl() {
    // Controle personalizado para alternar visibilidade de camadas (paradas / bikes)
    const FilterControl = L.Control.extend({
        options: { position: "topright" },

        onAdd() {
            const container = L.DomUtil.create(
                "div",
                "leaflet-control-custom leaflet-control-filter",
            );

            // HTML interno do controle (título + dois checkboxes)
            container.innerHTML = `
                <strong>Mostrar camadas</strong>
                <label>
                    <span>Paradas oficiais</span>
                    <input type="checkbox" value="stops" checked />
                </label>
                <label>
                    <span>Bike Itaú</span>
                    <input type="checkbox" value="bikes" checked />
                </label>
            `;

            // Adiciona evento de change em cada checkbox
            container.querySelectorAll("input").forEach((checkbox) => {
                checkbox.addEventListener("change", (event) => {
                    const { value, checked } = event.target;
                    // Atualiza estado de visibilidade da camada
                    layerVisibility[value] = checked;
                    // Aplica visibilidade no mapa
                    applyLayerVisibility(value);
                });
            });

            // Impede que cliques no controle interfiram no mapa
            L.DomEvent.disableClickPropagation(container);

            return container;
        },
    });

    map.addControl(new FilterControl());
}

function addRadiusControl() {
    // Controle personalizado para alterar o raio de busca (slider)
    const RadiusControl = L.Control.extend({
        options: { position: "topright" },

        onAdd() {
            const container = L.DomUtil.create(
                "div",
                "leaflet-control-custom leaflet-control-range",
            );

            // HTML do slider + valor atual do raio
            container.innerHTML = `
                <label for="radius-input">
                    Raio de busca:
                    <strong id="radius-value">${searchRadius} m</strong>
                </label>
                <input id="radius-input" type="range" min="200" max="5000" step="100" value="${searchRadius}">
            `;

            const rangeInput = container.querySelector("#radius-input");
            const radiusValue = container.querySelector("#radius-value");

            // Função chamada com debounce ao mudar o slider
            const onRangeChange = debounce((value) => {
                searchRadius = Number(value);              // atualiza variável global
                radiusValue.textContent = `${searchRadius} m`; // exibe texto

                if (radiusCircle) {
                    radiusCircle.setRadius(searchRadius); // atualiza círculo no mapa
                }

                if (userLocation) {
                    // Recarrega as paradas com o novo raio
                    fetchStops(userLocation, searchRadius);
                }
            }, 250);

            // Atualiza visualmente o texto e dispara o debounce
            rangeInput.addEventListener("input", (event) => {
                radiusValue.textContent = `${event.target.value} m`;
                onRangeChange(event.target.value);
            });

            // Evita conflito de scroll/click com o mapa
            L.DomEvent.disableClickPropagation(container);

            return container;
        },
    });

    map.addControl(new RadiusControl());
}

function applyLayerVisibility(layerKey) {
    // Mostra/oculta camada de paradas oficiais
    if (layerKey === "stops" && stopsCluster) {
        if (layerVisibility.stops) {
            map.addLayer(stopsCluster);
        } else {
            map.removeLayer(stopsCluster);
        }
    }

    // Mostra/oculta camada de estações de bike
    if (layerKey === "bikes" && bikeCluster) {
        if (layerVisibility.bikes) {
            map.addLayer(bikeCluster);
        } else {
            map.removeLayer(bikeCluster);
        }
    }
}

async function fetchStops(latlng, radius) {
    // Exibe mensagem de carregamento
    showLoading(true, "Carregando paradas oficiais da EPTC...");

    try {
        // Carrega em paralelo:
        // 1) paradas oficiais via GTFS
        // 2) estações de trem/metro via Overpass (railExtras)
        const [officialStops, railExtras] = await Promise.all([
            loadGtfsStops(),
            fetchRailExtras(latlng, radius),
        ]);

        // Enriquecer paradas oficiais com distância em relação ao usuário
        const enrichedStops = officialStops
            .map((stop) => ({
                ...stop,
                distance: getDistanceInMeters(latlng.lat, latlng.lng, stop.lat, stop.lng),
            }))
            // Filtra apenas as paradas dentro do raio
            .filter((stop) => stop.distance <= radius)
            // Ordena das mais próximas para as mais distantes
            .sort((a, b) => a.distance - b.distance)
            // Limita ao máximo de paradas renderizadas
            .slice(0, MAX_STOPS_RENDERED);

        // Junta paradas oficiais com as extras de trem/metro
        const combined = [...enrichedStops, ...railExtras];

        // Renderiza todas no mapa
        renderStops(combined);
    } catch (error) {
        console.error("Erro ao carregar paradas:", error);
        alert("Não foi possível carregar os dados oficiais no momento.");
    } finally {
        // Esconde loading independentemente de sucesso ou erro
        showLoading(false);
    }
}

async function loadGtfsStops() {
    // Se já temos cache das paradas, não baixa de novo
    if (gtfsStopsCache) {
        return gtfsStopsCache;
    }

    // Exibe mensagem de download de GTFS
    showLoading(true, "Baixando GTFS oficial da prefeitura...");

    // Faz download do arquivo ZIP com GTFS
    const response = await fetch(GTFS_ZIP_URL);

    if (!response.ok) {
        throw new Error("Falha ao baixar GTFS");
    }

    // Converte resposta binária para ArrayBuffer e depois para Uint8Array
    const arrayBuffer = await response.arrayBuffer();
    const zippedData = new Uint8Array(arrayBuffer);

    // Descompacta todos os arquivos do zip usando fflate
    const unzipResult = fflate.unzipSync(zippedData);

    // Tenta encontrar o arquivo de paradas (stops) em possíveis nomes
    const stopsFile =
        unzipResult["stops.txt"] || unzipResult["stops.csv"] || unzipResult["stops"] || null;

    if (!stopsFile) {
        throw new Error("Arquivo stops.txt não encontrado no GTFS");
    }

    // Decodifica o conteúdo do arquivo para texto (UTF-8)
    const stopsText = new TextDecoder("utf-8").decode(stopsFile);

    // Usa Papa.parse para interpretar CSV com cabeçalho
    const parsed = Papa.parse(stopsText, {
        header: true,        // primeira linha é cabeçalho
        dynamicTyping: true, // converte números automaticamente
        skipEmptyLines: true,
    });

    // Guarda metadados básicos
    gtfsMetadata = {
        rows: parsed.data.length,
        generatedAt: new Date().toISOString(),
    };

    // Transforma linhas do CSV em objetos de parada
    gtfsStopsCache = parsed.data
        // filtra apenas linhas com lat/lon válidos
        .filter((row) => row.stop_lat && row.stop_lon)
        .map((row) => ({
            id: row.stop_id,
            code: row.stop_code,
            name: row.stop_name,
            lat: Number(row.stop_lat),
            lng: Number(row.stop_lon),
            zone: row.zone_id,
            // tipo de parada (ônibus ou trensurb) deduzido pelo nome/dados
            type: deriveStopType(row),
            source: "Dados Abertos (GTFS)",
        }));

    return gtfsStopsCache;
}

function deriveStopType(row) {
    // Determina se a parada é de trem/metro ou ônibus
    const stopName = row.stop_name || "";

    // location_type = 1 normalmente indica estação
    // ou se o nome contém termos relacionados a trem/metro
    if (
        row.location_type === 1 ||
        /trensurb|trem|metro|subway/i.test(stopName)
    ) {
        return "trensurb";
    }

    // Caso contrário, considera parada de ônibus
    return "bus";
}

async function fetchRailExtras(latlng, radius) {
    // Monta consulta Overpass em sintaxe própria
    // Busca nós que sejam estação de trem/metro/subway_entrance
    // dentro de um raio em torno da posição atual
    const query = `
        [out:json][timeout:50];
        (
            node[railway=station](around:${radius},${latlng.lat},${latlng.lng});
            node[public_transport=station][subway=yes](around:${radius},${latlng.lat},${latlng.lng});
            node[railway=subway_entrance](around:${radius},${latlng.lat},${latlng.lng});
        );
        out;
    `;

    try {
        // Faz requisição GET para o Overpass API com a query codificada na URL
        const response = await fetch(
            `${OVERPASS_API}?data=${encodeURIComponent(query.trim())}`,
        );

        if (!response.ok) {
            throw new Error("Overpass falhou");
        }

        const data = await response.json();

        // Converte elementos retornados em objetos de parada compatíveis
        return (data.elements || []).map((element) => ({
            id: element.id,
            name: element.tags?.name || "Estação sem nome",
            lat: element.lat,
            lng: element.lon,
            type: "trensurb",       // considera sempre tipo trem/metro
            source: "OpenStreetMap",
            distance: getDistanceInMeters(
                latlng.lat,
                latlng.lng,
                element.lat,
                element.lon,
            ),
        }));
    } catch (error) {
        console.warn("Falha ao consultar Overpass:", error);
        // Em caso de erro, apenas não adiciona extras
        return [];
    }
}

function renderStops(stops) {
    // Remove cluster antigo de paradas, se existir
    if (stopsCluster) {
        map.removeLayer(stopsCluster);
    }

    // Cria um novo cluster de marcadores
    stopsCluster = L.markerClusterGroup({
        disableClusteringAtZoom: 17, // a partir desse zoom, não agrupa mais
        spiderfyOnMaxZoom: false,    // não abre "teia" de marcadores no máximo zoom
        showCoverageOnHover: false,  // não mostra o polígono de cobertura ao passar o mouse
    });

    // Para cada parada, cria um marcador e adiciona ao cluster
    stops.forEach((stop) => {
        const marker = L.marker([stop.lat, stop.lng], {
            icon: L.divIcon({
                className: `stop-marker ${stop.type ?? "bus"}`, // classe CSS depende do tipo
                html: stopIcon(stop.type),                      // ícone HTML definido por stopIcon
                iconSize: [34, 34],
            }),
        });

        // Monta conteúdo do popup de cada parada
        const popup = `
            <strong>${stop.name}</strong><br/>
            ${stop.code ? `Código: <b>${stop.code}</b><br/>` : ""}
            ${stop.distance ? `Distância: ${stop.distance.toFixed(0)} m<br/>` : ""}
            Fonte: ${stop.source || "Desconhecida"}
        `;

        marker.bindPopup(popup);
        stopsCluster.addLayer(marker);
    });

    // Só adiciona o cluster ao mapa se a camada de paradas estiver ativa
    if (layerVisibility.stops) {
        map.addLayer(stopsCluster);
    }
}

function stopIcon(type = "bus") {
    // Retorna HTML do ícone dependendo do tipo de parada
    if (type === "trensurb") {
        // Ícone de trem/metro (Font Awesome)
        return `<i class="fa-solid fa-train-subway marker-icon" aria-hidden="true"></i>`;
    }

    // Ícone padrão de ônibus
    return `<i class="fa-solid fa-bus-simple marker-icon" aria-hidden="true"></i>`;
}

async function fetchBikeStations(force = false) {
    const now = Date.now();

    // Se já temos cache recente (< 2 minutos) e não foi pedido force, reutiliza
    if (!force && bikeStationsCache && now - bikeLastFetched < 120000) {
        renderBikeStations(bikeStationsCache);
        return;
    }

    // Mostra mensagem de carregamento das estações de bike
    showLoading(true, "Buscando estações Bike Itaú...");

    try {
        // Requisição à API CityBikes
        const response = await fetch(CITY_BIKES_URL);

        if (!response.ok) {
            throw new Error("CityBikes indisponível");
        }

        const data = await response.json();

        // Estações ficam dentro de data.network.stations
        bikeStationsCache = data.network?.stations || [];
        bikeLastFetched = now;

        // Renderiza no mapa
        renderBikeStations(bikeStationsCache);
    } catch (error) {
        console.error("Erro ao carregar bikes:", error);
        alert("Não foi possível atualizar as estações Bike Itaú.");
    } finally {
        // Esconde indicador de carregamento
        showLoading(false);
    }
}

function renderBikeStations(stations) {
    // Remove cluster antigo de bikes, se existir
    if (bikeCluster) {
        map.removeLayer(bikeCluster);
    }

    // Cria cluster de estações de bike
    bikeCluster = L.markerClusterGroup({
        disableClusteringAtZoom: 16,
        spiderfyOnMaxZoom: false,
        showCoverageOnHover: false,
    });

    stations.forEach((station) => {
        // Cria marcador com ícone customizado (bicicleta + contador)
        const marker = L.marker([station.latitude, station.longitude], {
            icon: L.divIcon({
                className: "bike-marker",
                html: `
                    <i class="fa-solid fa-bicycle bike-icon" aria-hidden="true"></i>
                    <span class="bike-count">${station.free_bikes ?? 0}</span>
                `,
                iconAnchor: [20, 20],
            }),
        });

        // Popup com informações da estação
        const popup = `
            <strong>${station.name}</strong><br/>
            Bicicletas disponíveis: <b>${station.free_bikes ?? 0}</b><br/>
            Vagas livres: <b>${station.empty_slots ?? 0}</b><br/>
            Atualizado: ${formatTimestamp(station.timestamp)}
        `;

        marker.bindPopup(popup);
        bikeCluster.addLayer(marker);
    });

    // Só adiciona o cluster de bikes se camada estiver ativa
    if (layerVisibility.bikes) {
        map.addLayer(bikeCluster);
    }
}

function formatTimestamp(ts) {
    // Formata data/hora da API de bikes para padrão pt-BR
    if (!ts) return "sem informação";

    try {
        return new Date(ts).toLocaleString("pt-BR", {
            hour12: false,
        });
    } catch (error) {
        // Se falhar conversão, retorna string original
        return ts;
    }
}

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
    // Calcula distância entre dois pontos (lat/lon) usando fórmula de Haversine
    const R = 6371e3; // raio da Terra em metros
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    // Resultado em metros, arredondado
    return Math.round(R * c);
}

function showLoading(show, message) {
    // Se elementos de loading não existem no DOM, não faz nada
    if (!loadingEl || !loadingMessageEl) return;

    // Atualiza mensagem exibida, se fornecida
    if (message) {
        loadingMessageEl.textContent = message;
    }

    // Adiciona ou remove a classe "hidden" do overlay de loading
    loadingEl.classList.toggle("hidden", !show);
}

const btn = document.getElementById("btnSobre");
const box = document.getElementById("sobreBox");

btn.addEventListener("click", () => {
  if (box.style.display === "block") {
    box.style.display = "none";
  } else {
    box.style.display = "block";
  }
});

window.addEventListener("scroll", () => {
  const navbar = document.getElementById("navbar");

  if (window.scrollY > 2) {
      navbar.classList.add("active");   // ativa animação
  } else {
      navbar.classList.remove("active"); // volta ao normal
  }
});