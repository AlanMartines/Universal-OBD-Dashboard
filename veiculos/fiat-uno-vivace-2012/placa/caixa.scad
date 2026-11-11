// Caixa de proteção da placa da escuta CAN (Uno Vivace).
// Gerado por caixa.py (pela gerar_3d.py): não edite à mão; as medidas ficam no começo de caixa.py.
// F5 mostra a base e a tampa montadas; mude "mostrar" para "base" ou "tampa" e exporte o STL (F6, depois F7).
// Coordenadas em mm: x para a direita, y para cima (o lado do ESP32), z para cima.

mostrar = "montada";   // "montada", "base", "tampa" (virada para imprimir) ou "explodida"
$fn = 64;

module base() union() {
    translate([-4.5, -82.5, -7.5]) cube([75.000, 86.500, 2.000]);
    translate([68.5, -14.53, -5.5]) cube([2.000, 18.530, 25.500]);
    translate([68.5, -27.53, -5.5]) cube([2.000, 13.000, 16.200]);
    translate([68.5, -72.7, -5.5]) cube([2.000, 45.170, 25.500]);
    translate([68.5, -79.3, -5.5]) cube([2.000, 6.600, 6.200]);
    translate([68.5, -82.5, -5.5]) cube([2.000, 3.200, 25.500]);
    translate([-4.5, -82.5, -5.5]) cube([2.000, 86.500, 25.500]);
    translate([-2.5, 2, -5.5]) cube([71.000, 2.000, 25.500]);
    translate([-2.5, -82.5, -5.5]) cube([71.000, 2.000, 25.500]);
    translate([-7, 6.5, -7.5]) cylinder(r = 4, h = 15.500);
    translate([-7, 6.5, 8]) difference() { cylinder(r = 4, h = 12.000); translate([0, 0, -0.01]) cylinder(r = 1.3, h = 12.020); }
    translate([73, 6.5, -7.5]) cylinder(r = 4, h = 15.500);
    translate([73, 6.5, 8]) difference() { cylinder(r = 4, h = 12.000); translate([0, 0, -0.01]) cylinder(r = 1.3, h = 12.020); }
    translate([-7, -85, -7.5]) cylinder(r = 4, h = 15.500);
    translate([-7, -85, 8]) difference() { cylinder(r = 4, h = 12.000); translate([0, 0, -0.01]) cylinder(r = 1.3, h = 12.020); }
    translate([73, -85, -7.5]) cylinder(r = 4, h = 15.500);
    translate([73, -85, 8]) difference() { cylinder(r = 4, h = 12.000); translate([0, 0, -0.01]) cylinder(r = 1.3, h = 12.020); }
    translate([-11.5, -39.25, -7.5]) difference() { translate([-5, -8, 0]) cube([10, 16, 3.000]); translate([0, 0, -0.01]) cylinder(r = 2.25, h = 3.020); }
    translate([-6.5, -47.25, -7.5]) cube([2.500, 16.000, 3.000]);
    translate([-18, -47.25, -7.5]) cube([1.500, 16.000, 3.000]);
    translate([-23, -47.25, -7.5]) cube([2.800, 16.000, 3.000]);
    translate([-20.2, -36.55, -7.5]) cube([2.200, 5.300, 3.000]);
    translate([-20.2, -47.25, -7.5]) cube([2.200, 5.300, 3.000]);
    translate([77.5, -39.25, -7.5]) difference() { translate([-5, -8, 0]) cube([10, 16, 3.000]); translate([0, 0, -0.01]) cylinder(r = 2.25, h = 3.020); }
    translate([70, -47.25, -7.5]) cube([2.500, 16.000, 3.000]);
    translate([82.5, -47.25, -7.5]) cube([1.500, 16.000, 3.000]);
    translate([86.2, -47.25, -7.5]) cube([2.800, 16.000, 3.000]);
    translate([84, -36.55, -7.5]) cube([2.200, 5.300, 3.000]);
    translate([84, -47.25, -7.5]) cube([2.200, 5.300, 3.000]);
    translate([0, -3.5, -5.5]) cube([3.500, 3.500, 5.500]);
    translate([-1.5, -2.4, -5.5]) cube([1.200, 3.900, 7.900]);
    translate([-1.5, 0.3, -5.5]) cube([3.900, 1.200, 7.900]);
    translate([46.5, -3.5, -5.5]) cube([3.500, 3.500, 5.500]);
    translate([50.3, -2.4, -5.5]) cube([1.200, 3.900, 7.900]);
    translate([47.6, 0.3, -5.5]) cube([3.900, 1.200, 7.900]);
    translate([0, -70, -5.5]) cube([3.500, 3.500, 5.500]);
    translate([-1.5, -71.5, -5.5]) cube([1.200, 3.900, 7.900]);
    translate([-1.5, -71.5, -5.5]) cube([3.900, 1.200, 7.900]);
    translate([46.5, -70, -5.5]) cube([3.500, 3.500, 5.500]);
    translate([50.3, -71.5, -5.5]) cube([1.200, 3.900, 7.900]);
    translate([47.6, -71.5, -5.5]) cube([3.900, 1.200, 7.900]);
    translate([59, -20, -5.5]) cube([8.000, 18.000, 13.900]);
    translate([58.3, -61, -5.5]) cube([10.000, 13.000, 13.900]);
}

module tampa_montada() union() {
    translate([26.43, -16.73, 20]) difference() { translate([-3.5, -3.5, 0]) cube([7, 7, 2.000]); translate([0, 0, -0.01]) cylinder(r = 1.5, h = 2.020); }
    translate([26.27, -2.8, 20]) difference() { translate([-4.55, -4.55, 0]) cube([9.1, 9.1, 2.000]); translate([0, 0, -0.01]) cylinder(r = 2.55, h = 2.020); }
    translate([-4.5, 1.75, 20]) cube([26.220, 2.250, 2.000]);
    translate([-4.5, -7.35, 20]) cube([26.220, 9.100, 2.000]);
    translate([-4.5, -13.23, 20]) cube([26.220, 5.880, 2.000]);
    translate([-4.5, -20.23, 20]) cube([26.220, 7.000, 2.000]);
    translate([-4.5, -82.5, 20]) cube([26.220, 62.270, 2.000]);
    translate([21.72, 1.75, 20]) cube([1.210, 2.250, 2.000]);
    translate([21.72, -13.23, 20]) cube([1.210, 5.880, 2.000]);
    translate([21.72, -20.23, 20]) cube([1.210, 7.000, 2.000]);
    translate([21.72, -82.5, 20]) cube([1.210, 62.270, 2.000]);
    translate([22.93, 1.75, 20]) cube([7.000, 2.250, 2.000]);
    translate([22.93, -13.23, 20]) cube([7.000, 5.880, 2.000]);
    translate([22.93, -82.5, 20]) cube([7.000, 62.270, 2.000]);
    translate([29.93, 1.75, 20]) cube([0.890, 2.250, 2.000]);
    translate([29.93, -13.23, 20]) cube([0.890, 5.880, 2.000]);
    translate([29.93, -20.23, 20]) cube([0.890, 7.000, 2.000]);
    translate([29.93, -82.5, 20]) cube([0.890, 62.270, 2.000]);
    translate([30.82, 1.75, 20]) cube([39.680, 2.250, 2.000]);
    translate([30.82, -7.35, 20]) cube([39.680, 9.100, 2.000]);
    translate([30.82, -13.23, 20]) cube([39.680, 5.880, 2.000]);
    translate([30.82, -20.23, 20]) cube([39.680, 7.000, 2.000]);
    translate([30.82, -82.5, 20]) cube([39.680, 62.270, 2.000]);
    translate([-7, 6.5, 20]) difference() { cylinder(r = 4, h = 2.000); translate([0, 0, -0.01]) cylinder(r = 1.7, h = 2.020); }
    translate([73, 6.5, 20]) difference() { cylinder(r = 4, h = 2.000); translate([0, 0, -0.01]) cylinder(r = 1.7, h = 2.020); }
    translate([-7, -85, 20]) difference() { cylinder(r = 4, h = 2.000); translate([0, 0, -0.01]) cylinder(r = 1.7, h = 2.020); }
    translate([73, -85, 20]) difference() { cylinder(r = 4, h = 2.000); translate([0, 0, -0.01]) cylinder(r = 1.7, h = 2.020); }
    translate([67, -13.53, 18]) cube([1.200, 15.230, 2.000]);
    translate([67, -71.7, 18]) cube([1.200, 43.170, 2.000]);
    translate([-2.2, -80.2, 18]) cube([1.200, 81.900, 2.000]);
    translate([-1, 0.5, 18]) cube([68.000, 1.200, 2.000]);
    translate([-1, -80.2, 18]) cube([68.000, 1.200, 2.000]);
    translate([68.5, -79.1, 7.3]) cube([2.000, 6.200, 12.700]);
    translate([2, -2, 1.9]) cylinder(r = 1.5, h = 18.100);
    translate([48, -2, 1.9]) cylinder(r = 1.5, h = 18.100);
    translate([48.8, -68.8, 1.9]) cylinder(r = 1.2, h = 18.100);
    translate([10.57, -66.21, 16]) cube([6.000, 4.000, 4.000]);
}

module tampa_para_imprimir() translate([0, 0, 22]) rotate([180, 0, 0]) tampa_montada();

if (mostrar == "base") base();
else if (mostrar == "tampa") tampa_para_imprimir();
else if (mostrar == "explodida") { color("#5f6b75") base(); color("#8a96a0", 0.9) translate([0, 0, 40]) tampa_montada(); }
else { color("#5f6b75") base(); color("#8a96a0", 0.6) tampa_montada(); }
