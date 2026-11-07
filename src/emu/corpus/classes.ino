// expect: sum=12 area=50 name=LED
struct Point { int x, y; };
class Rect {
 public:
  Rect(int w, int h) : w_(w), h_(h) {}
  int area() const { return w_ * h_; }
 private:
  int w_, h_;
};
const char *names[] = {"BTN", "LED"};
void setup() {
  Serial.begin(9600);
  Point p = {5, 7};
  Point *q = &p;
  Rect r(5, 10);
  Serial.print("sum="); Serial.print(q->x + q->y);
  Serial.print(" area="); Serial.print(r.area());
  Serial.print(" name="); Serial.println(names[1]);
}
void loop() {}
