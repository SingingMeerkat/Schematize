import React from "react";
import { observe } from "mobx";

function range(start, end) {
  return [...Array(1 + end - start).keys()].map((v) => start + v);
}

class PangenomeSchematic extends React.Component {
  constructor(props) {
    /*Only plain objects will be made observable. For non-plain objects it is considered the
		 responsibility of the constructor to initialize the observable properties. Either use
		 the @observable annotation or the extendObservable function.*/

    super(props);
    this.pathNames = [];
    this.components = [];

    this.loadIndexFile(this.props.store.jsonName) //initializes this.chunk_index
      .then(() => this.jsonFetch(this.props.store.getChunkURLs()[0]))
      .then(this.loadFirstJSON.bind(this));
    //whenever jsonName changes,
    observe(this.props.store, "jsonName", () => {
      this.loadIndexFile(this.props.store.jsonName);
    });
    // console.log("public ", process.env.PUBLIC_URL ) //PUBLIC_URL is empty
  }
  componentDidUpdate() {
    // console.log("#components: " + this.components);
  }
  openRelevantChunk(chunk_index) {
    this.chunk_index = chunk_index;
    const beginBin = this.props.store.getBeginBin();
    const endBin = this.props.store.getEndBin();
    const lastIndex = chunk_index["files"].length - 1;

    const findBegin = (entry) => entry["last_bin"] >= beginBin;
    const findEnd = (entry) => entry["last_bin"] >= endBin;
    let beginIndex = chunk_index["files"].findIndex(findBegin);
    let endIndex = chunk_index["files"].findIndex(findEnd);

    if (-1 === beginIndex || -1 === endIndex) {
      // conserving beginIndex if -1 < beginIndex < lastIndex
      const indexToCompare = [beginIndex, lastIndex];
      const findMinBegin = (index) => index >= 0;
      let trueBeginIndex =
        indexToCompare[indexToCompare.findIndex(findMinBegin)];

      beginIndex = trueBeginIndex;
      endIndex = lastIndex;
    }

    //will trigger chunk update in App.nextChunk() which calls this.loadJSON
    let URLprefix =
      process.env.PUBLIC_URL + "test_data/" + this.props.store.jsonName + "/";
    let fileArray = range(beginIndex, endIndex).map((index) => {
      return URLprefix + chunk_index["files"][index]["file"];
    });

    this.props.store.switchChunkURLs(fileArray);
  }
  loadIndexFile(jsonFilename) {
    let indexPath =
      process.env.PUBLIC_URL + "test_data/" + jsonFilename + "/bin2file.json";
    console.log("Reading", indexPath);
    return fetch(indexPath)
      .then((res) => res.json())
      .then((json) => {
        if (!this.props.store.getChunkURLs()[0]) {
          // Initial state
          let fileArray = [
            `${process.env.PUBLIC_URL}test_data/${this.props.store.jsonName}/${json["files"][0]["file"]}`,
            `${process.env.PUBLIC_URL}test_data/${this.props.store.jsonName}/${json["files"][1]["file"]}`,
          ];
          this.props.store.switchChunkURLs(fileArray);
        }
        console.log(`loadIndexFile ${this.props.store.getChunkURLs()}`);
        // This following part is important to scroll right and left on browser
        this.openRelevantChunk.call(this, json);
      });
  }
  jsonFetch(filepath) {
    if (!filepath)
      throw new Error(
        "No filepath given. Ensure chunknames in bin2file.json are correct."
      );

    console.log("Fetching", filepath);

    return fetch(process.env.PUBLIC_URL + filepath).then((res) => res.json());
  }
  loadFirstJSON(data) {
    this.jsonData = data;
    this.pathNames = this.jsonData.path_names;
    this.jsonData.mid_bin = data.last_bin; //placeholder

    let lastChunkURLIndex = this.props.store.chunkURLs.length - 1;

    if (
      this.props.store.getChunkURLs()[0] ===
      this.props.store.getChunkURLs()[lastChunkURLIndex]
    ) {
      this.processArray();
    } else {
      const [firstURL, ...rest] = this.props.store.getChunkURLs();
      console.log(`${firstURL} loaded`);
      this.rest = rest;
      this.currentRestIdx = -1;
      this.loadRestJSON.bind(this);
    }
  }
  //loadRestJSON will be called on this.rest, which should be an array
  loadRestJSON() {
    const lastChunkURLIndex = this.rest.length - 1;

    while (this.currentRestIdx !== lastChunkURLIndex) {
      this.jsonFetch(this.rest[this.currentRestIdx])
        .then(this.extractDataFromChunk.bind(this))
        //TODO Find a way to processArray only once all chunks have loaded
        .then(this.processArray());
    }
  }
  extractDataFromChunk(chunkContent) {
    if (this.jsonData.last_bin < chunkContent.last_bin) {
      this.jsonData.last_bin = chunkContent.last_bin;
      this.jsonData.mid_bin =
        (this.jsonData.last_bin - this.jsonData.first_bin) / 2; //boundary between two files
      this.jsonData.components.push(...chunkContent.components);
      // CAUTION Might not work well if two extractDataFromChunk function run at the same time!
      this.currentRestIdx += 1;
    } else {
      console.warn(
        "Chunk was already loaded.  Check the order you set store.chunkURLs"
      );
    }
  }
  processArray() {
    /*parses beginBin to endBin range, returns false if new file needed*/
    if (!this.jsonData) {
      return false;
    }
    let [beginBin, endBin] = [
      this.props.store.getBeginBin(),
      this.props.store.getEndBin(),
    ];
    if (this.jsonData.json_version !== 10) {
      throw MediaError(
        "Wrong Data JSON version: was expecting version 10, got " +
        this.jsonData.json_version +
        ".  " +
        "This version added last_bin to data chunk index.  " + // KEEP THIS UP TO DATE!
          "Using a mismatched data file and renderer will cause unpredictable behavior," +
          " instead generate a new data file using github.com/graph-genome/component_segmentation."
      );
    }
    this.props.store.setBinWidth(parseInt(this.jsonData.bin_width));
    console.log("Parsing components ", beginBin, " - ", endBin);
    //Fetch the next file when viewport no longer needs the first file.
    if (
      beginBin > this.jsonData.mid_bin ||
      beginBin < this.jsonData.first_bin
      //TODO: add checks for beginBin vs .first_bin & endBin vs .last_bin too
    ) {
      //only do a new chunk scan if it's needed
      this.openRelevantChunk(this.chunk_index); // this will trigger a second update cycle
      return false;
    } else {
      var componentArray = [];
      var offsetLength = 0;
      for (let [index, component] of this.jsonData.components.entries()) {
        if (component.last_bin >= beginBin) {
          var componentItem = new Component(component, offsetLength, index);
          offsetLength +=
            componentItem.arrivals.length + componentItem.departures.length - 1;
          componentArray.push(componentItem);
          if (component.first_bin > endBin && componentArray.length > 1) {
            break;
          }
        }
      }
      this.components = componentArray;
      console.log(
        "processArray",
        this.jsonData.first_bin,
        this.jsonData.last_bin
      );
      return true;
    }
  }
}

class Component {
  constructor(component, offsetLength, index) {
    this.offset = offsetLength;
    this.index = index;
    this.firstBin = component.first_bin;
    this.lastBin = component.last_bin;
    this.arrivals = [];
    for (let arrival of component.arrivals) {
      this.arrivals.push(new LinkColumn(arrival));
    }
    this.departures = [];
    for (let departure of component.departures) {
      //don't slice off adjacent here
      this.departures.push(new LinkColumn(departure));
    }
    // we do not know the x val for this component, yet
    this.x = 0;
    // deep copy of occupants
    this.occupants = Array.from(component.occupants);
    this.matrix = Array.from(component.matrix);
    this.num_bin = this.lastBin - this.firstBin + 1;
  }
}

class LinkColumn {
  constructor(linkColumn) {
    this.upstream = linkColumn.upstream;
    this.downstream = linkColumn.downstream;
    this.participants = linkColumn.participants; //new Set
    this.key = this.edgeToKey();
  }
  edgeToKey() {
    /**downstream and upstream are always in the same orientation regardless of if it is a
     * departing LinkColumn or an arriving LinkColumn.**/
    return (
      String(this.downstream).padStart(13, "0") +
      String(this.upstream).padStart(13, "0")
    );
  }
}

export default PangenomeSchematic;
