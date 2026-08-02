// ===== Service Worker Registration =====
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").then(reg => {
        console.log("MovieDrift PWA Active");

        // If a new service worker is waiting to activate, reload page
        if (reg.waiting) {
            reg.waiting.postMessage({ type: "SKIP_WAITING" });
            window.location.reload();
        }

        // Listen for updates
        reg.addEventListener("updatefound", () => {
            const newWorker = reg.installing;
            newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                    // New version installed → activate + reload page
                    newWorker.postMessage({ type: "SKIP_WAITING" });
                    window.location.reload();
                }
            });
        });
    });
}

// ===== PWA Install Prompt =====
let deferredPrompt;
const btn = document.getElementById("installBtn");

window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.style.display = "block";
});

btn.addEventListener("click", () => {
    btn.style.display = "none";
    deferredPrompt.prompt();
    deferredPrompt = null;
});

// ===== Main App Logic =====
// Show button after scroll
window.addEventListener("scroll", () => {
    const btn = document.getElementById("backToTop");
    if (window.scrollY > 250) {
        btn.classList.add("show");
    } else {
        btn.classList.remove("show");
    }
});

// Smooth scroll top
document.getElementById("backToTop").addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
});

/* ---------------- TRAILER SHOWCASE + UPCOMING RELEASES FULL SCRIPT ---------------- */
document.addEventListener("DOMContentLoaded", () => {

    /* ---------------- CONFIG ---------------- */
    const manualTrailers = []; // add manual trailers if needed
    const TMDB_API_KEY = "4d2474df29f79bf9c784634d44137413";
    const tmdbMode = "now_playing";
    const movieIds = [];
    const tmdbLimit = 100;
    const countdownSeconds = 5;

    /* ---------------- DOM ELEMENTS ---------------- */
    const playerPlaceholder = document.getElementById("ytPlayerPlaceholder");
    const titleEl = document.getElementById("trailerTitle");
    const descEl = document.getElementById("trailerDesc");
    const muteBtn = document.getElementById("muteToggle");
    const nextBtn = document.getElementById("nextTrailer");
    const prevBtn = document.getElementById("prevTrailer");
    const dotsWrap = document.getElementById("trailerDots");
    const posterGrid = document.getElementById("posterGrid");
    const searchInput = document.getElementById("searchInput");
    const trailerSection = document.getElementById("trailerShowcase");
    const upcomingGrid = document.getElementById("upcomingGrid");

    let playlist = [], currentIndex = 0, ytPlayer = null, isMuted = true;
    let countdownTimer = null;

    /* ---------------- SEARCH TOGGLE ---------------- */
    if (searchInput && trailerSection) {
        searchInput.addEventListener("input", () => {
            trailerSection.style.display = searchInput.value.trim() ? "none" : "block";
        });
    }

    /* ---------------- UTILS ---------------- */
    function extractYouTubeId(url) {
        if (!url) return null;
        if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
        try {
            const u = new URL(url);
            if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
            if (u.searchParams.has("v")) return u.searchParams.get("v");
        } catch {}
        const m = url.match(/[A-Za-z0-9_-]{11}/);
        return m ? m[0] : null;
    }

    function todayZero() { const d = new Date(); d.setHours(0,0,0,0); return d; }
    function daysLeft(date) { return Math.ceil((new Date(date) - todayZero()) / 86400000); }

    /* ---------------- YOUTUBE PLAYER ---------------- */
    function loadYTAPI() {
        return new Promise(res => {
            if (window.YT && window.YT.Player) return res();
            const s = document.createElement("script");
            s.src = "https://www.youtube.com/iframe_api";
            document.head.appendChild(s);
            window.onYouTubeIframeAPIReady = res;
        });
    }

    async function initPlayer() {
        await loadYTAPI();
        ytPlayer = new YT.Player(playerPlaceholder, {
            height: "100%",
            width: "100%",
            videoId: playlist[currentIndex].youtubeId,
            playerVars: { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, mute: 1 },
            events: {
                onReady: ev => ev.target.playVideo(),
                onStateChange: ev => { if (ev.data === 0) startCountdown(); }
            }
        });
    }

    async function loadAtIndex(i) {
        stopCountdown();
        if (!playlist.length) return;
        currentIndex = (i + playlist.length) % playlist.length;
        const t = playlist[currentIndex];
        titleEl.innerText = `${t.title} [${t.mediaType}]`;
        descEl.innerText = t.desc || "";
        if (ytPlayer) {
            ytPlayer.loadVideoById(t.youtubeId);
            if (isMuted) ytPlayer.mute(); else ytPlayer.unMute();
        } else {
            playerPlaceholder.innerHTML = "";
            await initPlayer();
        }
        updateDots();
    }

    function goNext() { stopCountdown(); loadAtIndex(currentIndex + 1); }
    function goPrev() { stopCountdown(); loadAtIndex(currentIndex - 1); }

    muteBtn.onclick = () => {
        isMuted = !isMuted;
        if (ytPlayer) (isMuted ? ytPlayer.mute() : ytPlayer.unMute());
        muteBtn.innerText = isMuted ? "Unmute" : "Mute";
    };
    nextBtn.onclick = goNext;
    prevBtn.onclick = goPrev;

    /* ---------------- COUNTDOWN ---------------- */
    function startCountdown() {
        if (!playlist.length) return;
        let timeLeft = countdownSeconds;
        titleEl.innerText = `${playlist[currentIndex].title} (Next in ${timeLeft}s)`;
        countdownTimer = setInterval(() => {
            timeLeft--;
            titleEl.innerText = `${playlist[currentIndex].title} (Next in ${timeLeft}s)`;
            if (timeLeft <= 0) { stopCountdown(); goNext(); }
        }, 1000);
    }

    function stopCountdown() { if (countdownTimer) clearInterval(countdownTimer); countdownTimer = null; }

    /* ---------------- PLAYLIST ---------------- */
    async function buildPlaylist() {
        manualTrailers.forEach(t => {
            const id = extractYouTubeId(t.youtube);
            if (id) playlist.push({ youtubeId: id, title: t.title, desc: t.desc, mediaType: t.mediaType || "Movie" });
        });

        if (!TMDB_API_KEY) { finishPlaylist(); return; }

        try {
            let mediaList = [];
            if (movieIds.length) mediaList = movieIds.map(id => ({ id, mediaType: "movie" }));
            else {
                const [movieR, tvR] = await Promise.all([
                    fetch(`https://api.themoviedb.org/3/movie/${tmdbMode}?api_key=${TMDB_API_KEY}&language=en-US`),
                    fetch(`https://api.themoviedb.org/3/tv/on_the_air?api_key=${TMDB_API_KEY}&language=en-US`)
                ]);
                const [movieJson, tvJson] = await Promise.all([movieR.json(), tvR.json()]);
                mediaList = [
                    ...movieJson.results.map(m => ({ ...m, mediaType: "Movie" })),
                    ...tvJson.results.map(t => ({ ...t, mediaType: "Series" }))
                ].slice(0, tmdbLimit);
            }

            if (mediaList.length) await loadTrailer(mediaList[0]);
            finishPlaylist();

            for (let i = 1; i < mediaList.length; i++) {
                setTimeout(() => loadTrailer(mediaList[i]), i * 1500);
            }

            fetchPosters();
            fetchUpcomingMedia();
        } catch (e) { console.warn("TMDB error", e); }
    }

    async function loadTrailer(item) {
        try {
            const type = item.mediaType === "Series" ? "tv" : "movie";
            const r = await fetch(`https://api.themoviedb.org/3/${type}/${item.id}/videos?api_key=${TMDB_API_KEY}&language=en-US`);
            const json = await r.json();
            const vid = json.results.find(v => v.site === "YouTube" && /trailer/i.test(v.type)) || json.results.find(v => v.site === "YouTube");
            if (vid) {
                playlist.push({ youtubeId: vid.key, title: item.title || item.name, desc: item.overview || "", mediaType: item.mediaType });
                if (playlist.length === 1) { renderDots(); loadAtIndex(0); }
            }
        } catch(e){ console.warn("Load trailer error", e); }
    }

    function finishPlaylist() {
        if (!playlist.length) {
            titleEl.innerText = "No trailers available";
            descEl.innerText = "Add manual trailers or configure TMDB.";
            return;
        }
        renderDots();
        loadAtIndex(0);
    }

    /* ---------------- DOTS & SHUFFLE ---------------- */
    function renderDots() {
        dotsWrap.innerHTML = "";
        playlist.forEach((_, i) => {
            const d = document.createElement("div");
            d.className = "dot";
            d.onclick = () => loadAtIndex(i);
            dotsWrap.appendChild(d);
        });
        updateDots();
    }

    function updateDots() {
        dotsWrap.querySelectorAll(".dot").forEach((d, i) => d.classList.toggle("active", i === currentIndex));
    }

    function shufflePlaylist() {
        stopCountdown();
        for (let i = playlist.length-1; i>0; i--){
            const j = Math.floor(Math.random()*(i+1));
            [playlist[i],playlist[j]] = [playlist[j],playlist[i]];
        }
        renderDots();
        loadAtIndex(0);
    }

    const shuffleBtn = document.createElement("button");
    shuffleBtn.innerText = "Shuffle";
    shuffleBtn.className = "trailer-btn";
    shuffleBtn.style.marginLeft = "10px";
    shuffleBtn.onclick = shufflePlaylist;
    document.querySelector(".trailer-controls")?.appendChild(shuffleBtn);

    /* ---------------- POSTER GRID ---------------- */
    async function fetchPosters() {
        if (!posterGrid) return;
        try {
            const res = await fetch(`https://api.themoviedb.org/3/trending/all/week?api_key=${TMDB_API_KEY}`);
            const data = await res.json();
            posterGrid.innerHTML = "";
            data.results.forEach(item => {
                if (!item.poster_path) return;
                const mediaLabel = item.media_type==="movie"?"Movie":item.media_type==="tv"?"Series":"Animation";
                const card = document.createElement("div");
                card.className="poster-card";
                card.innerHTML = `<div class="poster-image-wrapper"><img src="https://image.tmdb.org/t/p/w500${item.poster_path}" alt="${item.title||item.name}"><span class="media-label ${mediaLabel}">${mediaLabel}</span></div><div class="poster-info">${item.title||item.name}</div>`;
                card.onclick = () => playPosterTrailer(item);
                posterGrid.appendChild(card);
            });
        } catch(e){ console.warn("Poster fetch error", e); }
    }

    async function playPosterTrailer(item){
        const title = item.title || item.name;
        let idx = playlist.findIndex(p => p.title === title);
        if(idx === -1 && item.id){
            await loadTrailer(item);
            renderDots();
            idx = playlist.findIndex(p => p.title === title);
        }
        loadAtIndex(idx);
    }

    /* ---------------- UPCOMING RELEASES ---------------- */
    const seen = new Set(JSON.parse(localStorage.getItem("seenUpcoming")||"[]"));
    async function fetchUpcomingMedia(){
        if(!upcomingGrid) return;
        try{
            const today = todayZero();
            const upcomingList = [];
            const addedIds = new Set();
            for(let page=1; page<=10; page++){
                const [moviesRes,tvRes] = await Promise.all([
                    fetch(`https://api.themoviedb.org/3/movie/upcoming?api_key=${TMDB_API_KEY}&language=en-US&page=${page}`),
                    fetch(`https://api.themoviedb.org/3/tv/on_the_air?api_key=${TMDB_API_KEY}&language=en-US&page=${page}`)
                ]);
                const [moviesData,tvData] = await Promise.all([moviesRes.json(),tvRes.json()]);
                moviesData.results.forEach(m=>{
                    if(!m.release_date || new Date(m.release_date) <= today) return;
                    const id="m"+m.id; if(addedIds.has(id)) return; addedIds.add(id);
                    upcomingList.push({id,title:m.title,poster:m.poster_path,mediaType:"Movie",releaseDate:m.release_date});
                });
                tvData.results.forEach(t=>{
                    if(!t.first_air_date || new Date(t.first_air_date) <= today) return;
                    const id="t"+t.id; if(addedIds.has(id)) return; addedIds.add(id);
                    upcomingList.push({id,title:t.name,poster:t.poster_path,mediaType:"Series",releaseDate:t.first_air_date});
                });
            }
            renderUpcoming(upcomingList);
            localStorage.setItem("seenUpcoming",JSON.stringify([...seen]));
        } catch(e){ console.warn("Upcoming media fetch error",e);}
    }

    function renderUpcoming(list){
        if(!upcomingGrid) return;
        upcomingGrid.innerHTML = "";
        list.forEach(item => {
            if(!item.poster) return;
            const releaseYear = item.releaseDate?item.releaseDate.slice(0,4):"TBA";
            const isNew = !seen.has(item.id);
            const card = document.createElement("div");
            card.className="upcoming-card";
            card.innerHTML = `<div class="upcoming-image-wrapper"><img src="https://image.tmdb.org/t/p/w500${item.poster}" alt="${item.title}"><span class="media-label ${item.mediaType}">${item.mediaType}</span><span class="countdown-badge">${daysLeft(item.releaseDate)} days left</span>${isNew?'<span class="new-badge">NEW</span>':''}</div><div class="upcoming-info"><div class="upcoming-title">${item.title}</div><div class="upcoming-year">${releaseYear}</div></div>`;
            upcomingGrid.appendChild(card);
            seen.add(item.id);
        });
    }

    setInterval(fetchUpcomingMedia, 15*60*1000);

    /* ---------------- POSTER / UPCOMING SCROLL ---------------- */
    const posterGridEl = document.getElementById("posterGrid");
    const leftArrow = document.querySelector(".left-arrow");
    const rightArrow = document.querySelector(".right-arrow");
    if(posterGridEl && leftArrow && rightArrow){
        leftArrow.onclick = ()=> posterGridEl.scrollBy({left:-300,behavior:"smooth"});
        rightArrow.onclick = ()=> posterGridEl.scrollBy({left:300,behavior:"smooth"});
    }
    const upLeft = document.querySelector(".upcoming-arrow.left");
    const upRight = document.querySelector(".upcoming-arrow.right");
    if(upLeft && upRight && upcomingGrid){
        upLeft.onclick = ()=> upcomingGrid.scrollBy({left:-320,behavior:"smooth"});
        upRight.onclick = ()=> upcomingGrid.scrollBy({left:320,behavior:"smooth"});
    }

    /* ---------------- CSS ---------------- */
    /* ---------------- FULL CSS INJECTION ---------------- */
    const style = document.createElement("style");
    style.innerHTML = `

/* ---------------- POSTER GRID & MEDIA LABELS ---------------- */
.poster-image-wrapper {
  position: relative;
  display: inline-block;
}
.media-label {
  position: absolute;
  top: 8px;
  left: 8px;
  font-size: 0.7rem;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 4px;
  color: #000;
  z-index: 10;
}
.media-label.Movie { background-color: #00ff66; }   /* Green */
.media-label.Series { background-color: #3399ff; }  /* Blue */
.media-label.Animation { background-color: #ffcc00; } /* Yellow */
.poster-card img {
  width: 100%;
  display: block;
  border-radius: 6px;
}
.poster-info {
  margin-top: 5px;
  text-align: center;
  font-weight: bold;
}


/* ---------------- UPCOMING RELEASES ---------------- */
#upcomingSection {
  padding: 20px 15px;
  background-color: #000;
  color: #fff;
  position: relative;
}
#upcomingSection h2 {
  font-size: 2rem;
  margin-bottom: 15px;
  font-weight: 900;
  color: #00ff66;
  letter-spacing: 1px;
}
.upcoming-wrapper { position: relative; }
#upcomingGrid {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  scroll-behavior: smooth;
  padding: 5px 0 10px;
  scrollbar-width: none;
}
#upcomingGrid::-webkit-scrollbar { display: none; }
.upcoming-card {
  flex: 0 0 160px;
  max-width: 160px;
  background-color: #0a0a0a;
  border-radius: 10px;
  transition: transform 0.3s, box-shadow 0.3s;
  cursor: pointer;
}
.upcoming-card:hover {
  transform: scale(1.05);
  box-shadow: 0 10px 25px rgba(0, 255, 102, 0.5);
}
.upcoming-image-wrapper {
  position: relative;
  border-radius: 10px;
  overflow: hidden;
}
.upcoming-image-wrapper img {
  width: 100%;
  display: block;
  border-radius: 10px;
}
.upcoming-info {
  padding: 8px 4px;
  text-align: center;
}
.upcoming-title {
  font-size: 1rem;
  font-weight: bold;
  color: #00ff66;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.upcoming-year { font-size: 0.85rem; color: #00ff66; }
.media-label {
  position: absolute;
  top: 6px;
  left: 6px;
  font-size: 0.7rem;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 5px;
  color: #000;
  z-index: 10;
}
.media-label.Movie { background-color: #00ff66; }
.media-label.Series { background-color: #3399ff; }
.countdown-badge {
  position: absolute;
  bottom: 8px;
  left: 8px;
  background: #000;
  color: #00ff66;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
}
.new-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  background: #ff004c;
  color: #fff;
  font-size: 11px;
  padding: 4px 6px;
  border-radius: 6px;
}

/* ---------------- UPCOMING GRID ARROWS ---------------- */
.upcoming-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(0,0,0,0.7);
  border: none;
  color: #00ff66;
  font-size: 22px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  cursor: pointer;
  z-index: 20;
}
.upcoming-arrow.left { left: -5px; }
.upcoming-arrow.right { right: -5px; }

/* ---------------- RESPONSIVE ---------------- */
@media (max-width: 1200px) { .upcoming-card { flex: 0 0 140px; max-width: 140px; } }
@media (max-width: 992px) { .upcoming-card { flex: 0 0 130px; max-width: 130px; } }
@media (max-width: 992px) { .upcoming-arrow { width: 32px; height: 32px; font-size: 20px; } }
@media (max-width: 768px) { .upcoming-card { flex: 0 0 120px; max-width: 120px; } #upcomingGrid { gap: 12px; } }
@media (max-width: 480px) { 
  .upcoming-card { flex: 0 0 100px; max-width: 100px; } 
  #upcomingGrid { gap: 8px; padding: 5px 0 8px; } 
  #upcomingSection h2 { font-size: 1.5rem; } 
  .upcoming-arrow { width: 28px; height: 28px; font-size: 18px; } 
}

`;
    document.head.appendChild(style);

    /* ---------------- START ---------------- */
    buildPlaylist();

});

let compareFirstMovie = null; // stores first selected movie index

function renderMovies() {
    const grid = document.getElementById("grid");
    const searchText = document.getElementById("search").value.toLowerCase();
    const selectedGenre = genreFilter.value;
    const selectedYear = yearFilter.value;
    const selectedType = document.getElementById("typeFilter").value;

    grid.innerHTML = "";

    const filtered = movies.filter(m => {
        const matchesSearch = (m.title || "").toLowerCase().includes(searchText);
        const matchesGenre = !selectedGenre || (m.genres && m.genres.includes(selectedGenre));
        const matchesYear  = !selectedYear || m.year == selectedYear;
        const matchesType  = !selectedType || m.type === selectedType || !m.type;
        return matchesSearch && matchesGenre && matchesYear && matchesType;
    });

    const now = Date.now();

    filtered.forEach((m, index) => {
        let badgesHTML = "";

        if (m.type !== "Series" && now - (m.createdAt || 0) < 86400000) {
            badgesHTML += `<div class="movie-glow-badge fade-out-24h">NEW MOVIE</div>`;
        }

        if (m.views && m.views >= 1000) {
            badgesHTML += `<div class="hot-badge">HOT</div>`;
        }

        if (m.type === "Series" && m.episodes?.length) {
            const latest  = m.episodes[m.episodes.length - 1];
            const isFresh = now - (latest.createdAt || now) < 86400000;
            const ep      = latest.ep || 0;
            const season  = latest.season || 1;
            if (isFresh && !hasWatched(m.id, ep)) {
                badgesHTML += `<div class="new-badge fade-out-24h">NEW Episode S${season}E${ep}</div>`;
            }
        }

        const ratingText = m.rating ? `${m.rating.toFixed(1)} / 10 (${Math.round(m.rating * 10)}%)` : "";

        const card = document.createElement("div");
        card.className = "card";

        card.innerHTML = `
      <div class="poster-wrapper" style="position:relative;">
        <div class="badges-container">${badgesHTML}</div>
        <img class="poster" src="${m.poster || ""}">
        <div class="compare-circle" onclick="selectSecondMovie(${index})" title="Select for comparison"></div>
      </div>

      <div class="card-body">
        <h3 class="movie-title">${(m.title || '').replace(/</g,'&lt;')}</h3>
        <div class="meta">${m.year || ''} · ${(m.genres || []).join(", ")}</div>
        <div class="rating">${ratingText}</div>

        <div class="card-actions">
          <button class="btn-icon" title="Details" onclick="protectedAction('details', ${index})">Details</button>
          <button class="btn-icon" title="Add to Watchlist" onclick="event.stopPropagation(); protectedAction('add', ${index})">Add</button>
          <button class="btn-icon" title="Watch Movie" onclick="protectedAction('watch', ${index})">Watch</button>
          <button class="btn-icon" title="Compare" onclick="event.stopPropagation(); openCompare(${index})">Compare</button>
        </div>
      </div>
    `;

        card.querySelector(".poster").onclick = () => protectedAction("watch", index);
        grid.appendChild(card);
    });

    window.currentFiltered = filtered;
}

// Open first movie or second movie selection
function openCompare(index) {
    const selectedMovie = window.currentFiltered[index];

    if (!compareFirstMovie) {
        compareFirstMovie = selectedMovie;
        alert("🎬 First movie selected. Please select another movie to compare.");

        document.querySelectorAll("#grid .card").forEach((card, i) => {
            if (i !== index) {
                const circle = card.querySelector(".compare-circle");
                if (circle) circle.style.display = "block";
            }
        });
    } else {
        selectSecondMovie(index);
    }
}

// Open modal with both movies
function selectSecondMovie(index) {
    const secondMovie = window.currentFiltered[index];
    if (!compareFirstMovie || !secondMovie) return;

    // Open modal
    openCompareModal(compareFirstMovie, secondMovie);

    // Reset
    compareFirstMovie = null;
    document.querySelectorAll(".compare-circle").forEach(c => c.style.display = "none");
}

function openCompareModal(movie1, movie2) {
    const modal = document.getElementById("compareModal");
    modal.style.display = "flex";

    // Set movie posters and titles
    document.getElementById("compareMovie1").querySelector("img").src = movie1.poster;
    document.getElementById("compareMovie1").querySelector("h3").textContent = movie1.title;

    document.getElementById("compareMovie2").querySelector("img").src = movie2.poster;
    document.getElementById("compareMovie2").querySelector("h3").textContent = movie2.title;

    // Animated stat bars
    document.getElementById("ratingBar").style.width = `${Math.round(Math.max(movie1.rating||0, movie2.rating||0)/10*100)}%`;
    document.getElementById("viewsBar").style.width = `${Math.min(Math.max(movie1.views||0, movie2.views||0)/1000*100, 100)}%`;

    const now = Date.now();
    const factors = [];

    // Rating comparison
    if ((movie1.rating || 0) > (movie2.rating || 0)) factors.push({ movie: movie1, reason: "higher rating" });
    else if ((movie2.rating || 0) > (movie1.rating || 0)) factors.push({ movie: movie2, reason: "higher rating" });

    // Popularity comparison
    const views1 = movie1.views || 0;
    const views2 = movie2.views || 0;
    if (views1 > views2) factors.push({ movie: movie1, reason: "more popular" });
    else if (views2 > views1) factors.push({ movie: movie2, reason: "more popular" });

    // Recency comparison (new releases within 7 days)
    const age1 = now - (movie1.createdAt || now);
    const age2 = now - (movie2.createdAt || now);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    if (age1 < age2 && age1 < weekMs) factors.push({ movie: movie1, reason: "new release" });
    else if (age2 < age1 && age2 < weekMs) factors.push({ movie: movie2, reason: "new release" });

    // Duration & type comparison for time-aware recommendation
    const duration1 = movie1.duration || 0;
    const duration2 = movie2.duration || 0;

    if (movie1.type === "Series" && movie2.type !== "Series") {
        factors.push({ movie: movie2, reason: `shorter watch time (${movie2.type})` });
    } else if (movie2.type === "Series" && movie1.type !== "Series") {
        factors.push({ movie: movie1, reason: `shorter watch time (${movie1.type})` });
    } else if (duration1 > duration2) {
        factors.push({ movie: movie2, reason: "shorter duration" });
    } else if (duration2 > duration1) {
        factors.push({ movie: movie1, reason: "shorter duration" });
    }

    // Count the factor scores
    const score = {};
    [movie1, movie2].forEach(m => score[m.title] = 0);
    factors.forEach(f => score[f.movie.title]++);

    // Decide final recommendation
    let finalRecommendation = "";
    if (score[movie1.title] > score[movie2.title]) finalRecommendation = ` Watch "${movie1.title}" first, then "${movie2.title}".`;
    else if (score[movie2.title] > score[movie1.title]) finalRecommendation = ` Watch "${movie2.title}" first, then "${movie1.title}".`;
    else finalRecommendation = ` Both are similar. You can choose either first.`;

    // Build explanation text
    let explanation = factors.map(f => ` "${f.movie.title}" is favored because of ${f.reason}.`).join("<br>");

    // Display in AI container
    const aiContainer = document.getElementById("aiExplanation");
    aiContainer.innerHTML = `
    <div>
      <div style="margin-bottom: 8px;">Analysis:</div>
      ${explanation || 'No clear preference based on rating, popularity, recency, duration, or type.'}
      <div style="margin-top: 8px; font-weight: bold;">${finalRecommendation}</div>
    </div>
  `;
}

function closeCompareModal() {
    document.getElementById("compareModal").style.display = "none";
}


// ===== New Year Overlay / Fireworks / Confetti =====
// ===== NEW YEAR LOGIC =====
const overlay = document.getElementById('newYearOverlay');
const yearText = document.getElementById('yearText');
const today = new Date();
const month = today.getMonth(); // 0=Jan
const day = today.getDate();
const year = today.getFullYear();

// Show overlay only between Jan 1 - Jan 20
if(month === 0 && day <= 10) {
    yearText.textContent = year; // dynamic year

    const storageKey = `newYearShown-${year}`;
    if(!localStorage.getItem(storageKey)) {
        overlay.style.display = 'flex';
        localStorage.setItem(storageKey, 'true');

        // Fade out overlay after 10 seconds
        setTimeout(() => {
            overlay.style.opacity = 0;
            setTimeout(() => overlay.remove(), 2000);
        }, 10000);
    } else {
        overlay.remove();
    }
} else {
    overlay.remove();
}

/* ===== RESPONSIVE TEXT ===== */
function scaleText() {
    const textElem = document.getElementById('newYearText');
    const width = window.innerWidth;
    if(width < 400){
        textElem.style.fontSize = '1.8rem';
    } else if(width < 768){
        textElem.style.fontSize = '2.5rem';
    } else {
        textElem.style.fontSize = '3rem';
    }
}
scaleText();
window.addEventListener('resize', scaleText);

/* ===== FIREWORKS CANVAS ===== */
const canvasFW = document.getElementById('fireworks');
const ctxFW = canvasFW.getContext('2d');

function resizeFW() {
    canvasFW.width = window.innerWidth;
    canvasFW.height = window.innerHeight;
}
resizeFW();
window.addEventListener('resize', resizeFW);

/* ===== FIREWORK & PARTICLE ===== */
class Firework {
    constructor() {
        this.x = Math.random() * canvasFW.width;
        this.y = canvasFW.height;
        this.targetY = Math.random() * canvasFW.height / 2;
        this.radius = 2;
        this.color = `hsl(${Math.random()*360},100%,60%)`;
        this.speed = Math.random() * 3 + 3;
        this.trail = [];
    }
    update() {
        this.trail.push({x:this.x,y:this.y});
        if(this.trail.length>10) this.trail.shift();
        this.y -= this.speed;
        if(this.y <= this.targetY){
            // Reduce number of particles for mobile
            const count = window.innerWidth < 500 ? 15 : 30;
            for(let i=0;i<count;i++) particles.push(new Particle(this.x,this.y,this.color));
            return true;
        }
        return false;
    }
    draw() {
        ctxFW.beginPath();
        for(let i=0;i<this.trail.length;i++){
            const t = this.trail[i];
            ctxFW.globalAlpha = i/this.trail.length;
            ctxFW.fillStyle = this.color;
            ctxFW.beginPath();
            ctxFW.arc(t.x,t.y,this.radius,0,Math.PI*2);
            ctxFW.fill();
        }
        ctxFW.globalAlpha = 1;
        ctxFW.beginPath();
        ctxFW.arc(this.x,this.y,this.radius,0,Math.PI*2);
        ctxFW.fillStyle = this.color;
        ctxFW.shadowColor = this.color;
        ctxFW.shadowBlur = 10;
        ctxFW.fill();
    }
}

class Particle {
    constructor(x,y,color){
        this.x=x; this.y=y;
        this.radius=Math.random()*2+1;
        this.color=color;
        this.velocityX=(Math.random()-0.5)*6;
        this.velocityY=(Math.random()-0.5)*6;
        this.life=60;
    }
    update(){ this.x+=this.velocityX; this.y+=this.velocityY; this.life--; }
    draw(){
        ctxFW.beginPath();
        ctxFW.arc(this.x,this.y,this.radius,0,Math.PI*2);
        ctxFW.fillStyle=this.color;
        ctxFW.shadowColor=this.color;
        ctxFW.shadowBlur=10;
        ctxFW.fill();
    }
}

let fireworks=[], particles=[];
function animateFW(){
    if(!document.getElementById('newYearOverlay')) return;
    ctxFW.fillStyle='rgba(0,0,0,0.2)';
    ctxFW.fillRect(0,0,canvasFW.width,canvasFW.height);
    if(Math.random() < 0.05) fireworks.push(new Firework());
    fireworks = fireworks.filter(fw=>{ fw.draw(); return !fw.update(); });
    particles = particles.filter(p=>{ p.draw(); p.update(); return p.life>0; });
    requestAnimationFrame(animateFW);
}
animateFW();

/* ===== CONFETTI CANVAS ===== */
const canvasCF = document.getElementById('confetti');
const ctxCF = canvasCF.getContext('2d');

function resizeCF() {
    canvasCF.width = window.innerWidth;
    canvasCF.height = window.innerHeight;
}
resizeCF();
window.addEventListener('resize', resizeCF);

class Confetti {
    constructor(){
        this.x=Math.random()*canvasCF.width;
        this.y=Math.random()*-canvasCF.height;
        this.size=Math.random()*8+4;
        // smaller size on mobile
        if(window.innerWidth < 500) this.size = Math.random()*5+2;
        this.color=`hsl(${Math.random()*360},100%,60%)`;
        this.speedY=Math.random()*3+2;
        this.speedX=(Math.random()-0.5)*2;
        this.rotation=Math.random()*360;
        this.rotationSpeed=(Math.random()-0.5)*10;
    }
    update(){
        this.x+=this.speedX;
        this.y+=this.speedY;
        this.rotation+=this.rotationSpeed;
        if(this.y>canvasCF.height)this.y=-10;
    }
    draw(){
        ctxCF.save();
        ctxCF.translate(this.x,this.y);
        ctxCF.rotate(this.rotation*Math.PI/180);
        ctxCF.fillStyle=this.color;
        ctxCF.shadowColor=this.color;
        ctxCF.shadowBlur=8;
        ctxCF.fillRect(-this.size/2,-this.size/2,this.size,this.size);
        ctxCF.restore();
    }
}

let confettis=[];
for(let i=0;i<150;i++){
    confettis.push(new Confetti());
}

function animateCF(){
    if(!document.getElementById('newYearOverlay')) return;
    ctxCF.clearRect(0,0,canvasCF.width,canvasCF.height);
    confettis.forEach(c=>{ c.update(); c.draw(); });
    requestAnimationFrame(animateCF);
}
animateCF();
