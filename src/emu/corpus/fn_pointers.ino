// expect: add=7 sub=-1 mul=12 div=0.75
// expect: sorted=1,2,3,5,8,13
// expect: max=13 at=5
// C++ du quotidien hors interpréteur : pointeurs de fonctions, tableau de structures, tri avec qsort(), références.
#include <stdlib.h>
struct Op { const char *name; float (*fn)(float, float); };
float add(float a, float b) { return a + b; }
float sub(float a, float b) { return a - b; }
float mul(float a, float b) { return a * b; }
float dv(float a, float b) { return a / b; }
int cmp(const void *x, const void *y) { return *(const int *)x - *(const int *)y; }
void maxOf(const int *v, int n, int &m, int &at) { m = v[0]; at = 0; for (int i = 1; i < n; i++) if (v[i] > m) { m = v[i]; at = i; } }
void setup() {
  Serial.begin(9600);
  Op ops[] = { { "add", add }, { "sub", sub }, { "mul", mul }, { "div", dv } };
  for (auto &o : ops) { Serial.print(o.name); Serial.print('='); float r = o.fn(3, 4); if (r == (int)r) Serial.print((int)r); else Serial.print(r, 2); Serial.print(' '); }
  Serial.println();
  int v[] = { 8, 3, 13, 1, 5, 2 };
  qsort(v, 6, sizeof(int), cmp);
  Serial.print("sorted=");
  for (int i = 0; i < 6; i++) { Serial.print(v[i]); if (i < 5) Serial.print(','); }
  Serial.println();
  int m, at; maxOf(v, 6, m, at);
  Serial.print("max="); Serial.print(m); Serial.print(" at="); Serial.println(at);
}
void loop() {}
