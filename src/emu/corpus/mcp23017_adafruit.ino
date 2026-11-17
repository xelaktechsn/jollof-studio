// expect: mcp-ok
// expect: b0=0 b1=1
// module: {"type":"mcp23017","addr":[32],"levels":{"GPB0":0}}
// chip-out: {"type":"mcp23017","GPA0":1,"GPA1":0,"GPA7":1}
// Extenseur MCP23017 avec la vraie bibliothèque Adafruit_MCP23X17 (Adafruit BusIO, registres IODIR, GPPU, GPIO, OLAT).
#include <Adafruit_MCP23X17.h>
Adafruit_MCP23X17 mcp;
void setup() {
  Serial.begin(9600);
  if (!mcp.begin_I2C()) { Serial.println("mcp-absent"); return; }
  mcp.pinMode(0, OUTPUT); mcp.pinMode(1, OUTPUT); mcp.pinMode(7, OUTPUT);
  mcp.digitalWrite(0, HIGH); mcp.digitalWrite(1, LOW); mcp.digitalWrite(7, HIGH);
  mcp.pinMode(8, INPUT_PULLUP); mcp.pinMode(9, INPUT_PULLUP);
  Serial.print("b0="); Serial.print(mcp.digitalRead(8)); Serial.print(" b1="); Serial.println(mcp.digitalRead(9));
  Serial.println("mcp-ok");
}
void loop() {}
