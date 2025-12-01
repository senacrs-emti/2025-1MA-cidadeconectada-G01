window.addEventListener("scroll", () => {
    const navbar = document.getElementById("navbar");

    if (window.scrollY > 5) {
        navbar.classList.add("active");   // ativa animação
    } else {
        navbar.classList.remove("active"); // volta ao normal
    }
});