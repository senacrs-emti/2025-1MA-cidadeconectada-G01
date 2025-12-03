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

