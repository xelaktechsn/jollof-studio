// expect: len=21 upper=TEMPERATURE=23,HUM=61
// expect: temp=23 hum=61 sum=84
// expect: replaced=temp:23;hum:61
// Classe String d'Arduino : concaténation, recherche, découpe, conversion en nombre (allocation dynamique).
void setup() {
  Serial.begin(9600);
  String s = "temperature=23";
  s += ",hum=" + String(61);
  Serial.print("len="); Serial.print(s.length());
  String u = s; u.toUpperCase();
  Serial.print(" upper="); Serial.println(u);
  int t = s.substring(s.indexOf('=') + 1, s.indexOf(',')).toInt();
  int h = s.substring(s.lastIndexOf('=') + 1).toInt();
  Serial.print("temp="); Serial.print(t); Serial.print(" hum="); Serial.print(h); Serial.print(" sum="); Serial.println(t + h);
  String r = s; r.replace("temperature", "temp"); r.replace("=", ":"); r.replace(",", ";");
  Serial.print("replaced="); Serial.println(r);
}
void loop() {}
