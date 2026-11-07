// expect: max=7 maxf=2.50
template <typename T> T biggest(T a, T b) { return a > b ? a : b; }
void setup() {
  Serial.begin(9600);
  Serial.print("max="); Serial.print(biggest(3, 7));
  Serial.print(" maxf="); Serial.println(biggest(2.5, 1.5));
}
void loop() {}
